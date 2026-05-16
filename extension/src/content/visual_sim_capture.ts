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
const AHASH_SIZE = 8;
const BHASH_SIZE = 16;

let _lastCaptureUrl = "";
let _lastResult: VisualSimResult | null = null;
let _captureInProgress = false;

export function getLastVisualSimResult(): VisualSimResult | null {
  return _lastResult;
}

export function resetVisualSimState(): void {
  _lastCaptureUrl = "";
  _lastResult = null;
  _captureInProgress = false;
}

export async function triggerVisualSimCheck(
  isCrossOriginFromBrand: boolean
): Promise<VisualSimResult> {
  const pageUrl = location.href;

  if (_captureInProgress) {
    return _lastResult ?? emptyResult();
  }

  if (_lastCaptureUrl === pageUrl && _lastResult) {
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

    const pixels8x8 = await downsampleToSize(dataUrl, AHASH_SIZE);
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
      _lastCaptureUrl = pageUrl;
      return result;
    }

    const t2 = performance.now();
    const pixels16x16 = await downsampleToSize(dataUrl, BHASH_SIZE);
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
    _lastCaptureUrl = pageUrl;
    return result;
  } catch {
    return emptyResult();
  } finally {
    _captureInProgress = false;
  }
}

function emptyResult(): VisualSimResult {
  return { matched: false, score: 0, captureMs: 0, hashMs: 0, compareMs: 0 };
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

async function downsampleToSize(
  dataUrl: string,
  targetSize: number
): Promise<Uint8ClampedArray> {
  const img = await loadImage(dataUrl);
  const canvas = new OffscreenCanvas(targetSize, targetSize);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, targetSize, targetSize);
  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  return imageData.data;
}

function loadImage(dataUrl: string): Promise<ImageBitmap> {
  return fetch(dataUrl)
    .then((r) => r.blob())
    .then((blob) => createImageBitmap(blob));
}

export async function waitForStability(
  timeoutMs: number = STABILITY_WAIT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        settled = true;
        observer.disconnect();
        resolve(true);
      }, timeoutMs);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    timer = setTimeout(() => {
      if (!settled) {
        observer.disconnect();
        resolve(true);
      }
    }, timeoutMs);
  });
}
