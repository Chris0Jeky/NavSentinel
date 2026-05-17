/**
 * Visual Similarity Capture Pipeline (P4-01 W3-02)
 *
 * Triggered when a password field becomes visible. Captures the viewport
 * via the service worker, downsizes, hashes, and compares against the
 * brand template database.
 */

import { computeAHash, computeBHash } from "../shared/visual_sim_hash";
import {
  findAHashCandidates,
  confirmBHashMatch,
  computeVisualSimScore,
  isLoaded,
} from "../shared/visual_sim_templates";
import type { VisualSimResult, VisualSimMatch } from "../shared/visual_sim_types";
import { DEFAULT_VISUAL_SIM_CONFIG } from "../shared/visual_sim_types";

const STABILITY_WAIT_MS = DEFAULT_VISUAL_SIM_CONFIG.stabilityWaitMs;
const MAX_STABILITY_WAIT_MS = STABILITY_WAIT_MS * 6;
const AHASH_SIZE = 8;
const BHASH_SIZE = 16;

let _lastCaptureKey = "";
let _lastResult: VisualSimResult | null = null;
let _captureInProgress = false;

export function getLastVisualSimResult(): VisualSimResult | null {
  return _lastResult;
}

export function resetVisualSimState(): void {
  _lastCaptureKey = "";
  _lastResult = null;
  _captureInProgress = false;
}

export async function triggerVisualSimCheck(
  isCrossOriginFromBrand: boolean
): Promise<VisualSimResult> {
  const pageUrl = location.href;
  const cacheKey = getCaptureCacheKey(pageUrl, isCrossOriginFromBrand);

  if (_captureInProgress) {
    return _lastResult ?? emptyResult();
  }

  if (_lastCaptureKey === cacheKey && _lastResult) {
    return _lastResult;
  }

  if (!isLoaded()) {
    return emptyResult();
  }

  _captureInProgress = true;
  const t0 = performance.now();

  try {
    const dataUrl = await requestViewportCapture();
    if (!dataUrl) {
      return emptyResult();
    }

    const captureMs = performance.now() - t0;
    const t1 = performance.now();

    const img = await loadImage(dataUrl);
    try {
      const pixels8x8 = drawToSize(img, AHASH_SIZE);
      const aHash = computeAHash(pixels8x8, AHASH_SIZE, AHASH_SIZE);
      const candidates = findAHashCandidates(aHash);
      const hashMs = performance.now() - t1;

      if (candidates.length === 0) {
        const result: VisualSimResult = {
          matched: false,
          score: 0,
          captureMs,
          hashMs,
          compareMs: 0,
        };
        _lastResult = result;
        _lastCaptureKey = cacheKey;
        return result;
      }

      const t2 = performance.now();
      const pixels16x16 = drawToSize(img, BHASH_SIZE);
      const bHash = computeBHash(pixels16x16, BHASH_SIZE, BHASH_SIZE);

      let bestMatch: VisualSimMatch | undefined;

      for (const candidate of candidates) {
        const { matched, distance } = confirmBHashMatch(bHash, candidate.template);
        if (matched) {
          bestMatch = {
            brandId: candidate.template.id,
            brandName: candidate.template.displayName,
            confidence: "high",
            aHashDistance: candidate.distance,
            bHashDistance: distance,
          };
          break;
        }
        if (!bestMatch) {
          bestMatch = {
            brandId: candidate.template.id,
            brandName: candidate.template.displayName,
            confidence: "low",
            aHashDistance: candidate.distance,
            bHashDistance: distance,
          };
        }
      }

      const compareMs = performance.now() - t2;
      const score = bestMatch ? computeVisualSimScore(bestMatch, isCrossOriginFromBrand) : 0;

      const result: VisualSimResult = {
        matched: !!bestMatch && bestMatch.confidence === "high",
        ...(bestMatch ? { match: bestMatch } : {}),
        score,
        captureMs,
        hashMs,
        compareMs,
      };

      _lastResult = result;
      _lastCaptureKey = cacheKey;
      return result;
    } finally {
      img.close();
    }
  } catch {
    return emptyResult();
  } finally {
    _captureInProgress = false;
  }
}

function emptyResult(): VisualSimResult {
  return { matched: false, score: 0, captureMs: 0, hashMs: 0, compareMs: 0 };
}

function getCaptureCacheKey(pageUrl: string, isCrossOriginFromBrand: boolean): string {
  return `${pageUrl}|brandCrossOrigin=${isCrossOriginFromBrand ? "1" : "0"}`;
}

function drawToSize(img: ImageBitmap, size: number): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

async function requestViewportCapture(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "ns-capture-viewport" },
        (response) => {
          if (chrome.runtime.lastError || !response?.dataUrl) {
            resolve(null);
            return;
          }
          resolve(response.dataUrl as string);
        }
      );
    } catch {
      resolve(null);
    }
  });
}

function loadImage(dataUrl: string): Promise<ImageBitmap> {
  return fetch(dataUrl)
    .then((r) => r.blob())
    .then((blob) => createImageBitmap(blob));
}

export async function waitForStability(
  timeoutMs: number = STABILITY_WAIT_MS,
  maxWaitMs: number = MAX_STABILITY_WAIT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (stabilityTimer) clearTimeout(stabilityTimer);
      clearTimeout(maxTimer);
      resolve(result);
    };

    if (!document.body) {
      resolve(true);
      return;
    }

    const observer = new MutationObserver(() => {
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(() => done(true), timeoutMs);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    stabilityTimer = setTimeout(() => done(true), timeoutMs);

    const maxTimer = setTimeout(() => done(false), maxWaitMs);
  });
}
