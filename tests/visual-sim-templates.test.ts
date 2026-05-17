import { describe, expect, it, beforeEach } from "vitest";
import {
  getTemplates,
  isLoaded,
  loadTemplates,
  findAHashCandidates,
  confirmBHashMatch,
  computeVisualSimScore,
} from "../extension/src/shared/visual_sim_templates";
import { DEFAULT_VISUAL_SIM_CONFIG, type BrandTemplate, type VisualSimMatch } from "../extension/src/shared/visual_sim_types";

function makeTemplate(id: string, aHashFill: number, bHashFill: number): BrandTemplate {
  const aHash = new Uint8Array(8).fill(aHashFill);
  const bHash = new Uint8Array(32).fill(bHashFill);
  return { id, displayName: `Brand ${id}`, aHash, bHash, version: 1 };
}

describe("visual_sim_templates", () => {
  beforeEach(() => {
    loadTemplates([]);
  });

  describe("loadTemplates / getTemplates / isLoaded", () => {
    it("starts empty after reset", () => {
      expect(getTemplates()).toEqual([]);
      expect(isLoaded()).toBe(true);
    });

    it("loads and retrieves templates", () => {
      const templates = [makeTemplate("google", 0xFF, 0xAA)];
      loadTemplates(templates);
      expect(getTemplates()).toHaveLength(1);
      expect(getTemplates()[0]!.id).toBe("google");
      expect(isLoaded()).toBe(true);
    });

    it("returns a copy of loaded templates", () => {
      loadTemplates([makeTemplate("google", 0xFF, 0xAA)]);
      const copy = getTemplates();
      copy.length = 0;
      expect(getTemplates()).toHaveLength(1);
    });

    it("caps loaded templates at configured maximum", () => {
      const templates = Array.from(
        { length: DEFAULT_VISUAL_SIM_CONFIG.maxTemplates + 5 },
        (_, i) => makeTemplate(`brand-${i}`, i & 0xFF, 0xAA)
      );
      loadTemplates(templates);
      expect(getTemplates()).toHaveLength(DEFAULT_VISUAL_SIM_CONFIG.maxTemplates);
    });

    it("rejects invalid aHash lengths", () => {
      const template = makeTemplate("bad", 0xFF, 0xAA);
      template.aHash = new Uint8Array(7);
      expect(() => loadTemplates([template])).toThrow(/expected 8 bytes/);
    });

    it("rejects invalid bHash lengths", () => {
      const template = makeTemplate("bad", 0xFF, 0xAA);
      template.bHash = new Uint8Array(31);
      expect(() => loadTemplates([template])).toThrow(/expected 32 bytes/);
    });
  });

  describe("findAHashCandidates", () => {
    it("returns exact match at distance 0", () => {
      const template = makeTemplate("paypal", 0b11110000, 0x00);
      loadTemplates([template]);

      const queryHash = new Uint8Array(8).fill(0b11110000);
      const results = findAHashCandidates(queryHash);
      expect(results).toHaveLength(1);
      expect(results[0]!.distance).toBe(0);
      expect(results[0]!.template.id).toBe("paypal");
    });

    it("returns candidates within threshold", () => {
      const t1 = makeTemplate("google", 0b11110000, 0x00);
      const t2 = makeTemplate("github", 0b00001111, 0x00);
      loadTemplates([t1, t2]);

      const query = new Uint8Array(8).fill(0b11110001);
      const results = findAHashCandidates(query, 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const googleMatch = results.find(r => r.template.id === "google");
      expect(googleMatch).toBeDefined();
      expect(googleMatch!.distance).toBeLessThanOrEqual(10);
    });

    it("excludes candidates beyond threshold", () => {
      const template = makeTemplate("stripe", 0xFF, 0x00);
      loadTemplates([template]);

      const query = new Uint8Array(8).fill(0x00);
      const results = findAHashCandidates(query, 5);
      expect(results).toHaveLength(0);
    });

    it("sorts by distance ascending", () => {
      const t1 = makeTemplate("close", 0b11111110, 0x00);
      const t2 = makeTemplate("far", 0b11110000, 0x00);
      loadTemplates([t1, t2]);

      const query = new Uint8Array(8).fill(0xFF);
      const results = findAHashCandidates(query, 64);
      expect(results.length).toBe(2);
      expect(results[0]!.distance).toBeLessThanOrEqual(results[1]!.distance);
      expect(results[0]!.template.id).toBe("close");
    });

    it("returns empty array when no templates loaded", () => {
      loadTemplates([]);
      const query = new Uint8Array(8).fill(0xFF);
      expect(findAHashCandidates(query)).toHaveLength(0);
    });

    it("rejects invalid query hash lengths", () => {
      expect(() => findAHashCandidates(new Uint8Array(7))).toThrow(/expected 8-byte aHash/);
    });
  });

  describe("confirmBHashMatch", () => {
    it("confirms match when distance within threshold", () => {
      const template = makeTemplate("google", 0x00, 0b10101010);
      const queryBHash = new Uint8Array(32).fill(0b10101010);
      const result = confirmBHashMatch(queryBHash, template);
      expect(result.matched).toBe(true);
      expect(result.distance).toBe(0);
    });

    it("rejects match when distance exceeds threshold", () => {
      const template = makeTemplate("google", 0x00, 0xFF);
      const queryBHash = new Uint8Array(32).fill(0x00);
      const result = confirmBHashMatch(queryBHash, template);
      expect(result.matched).toBe(false);
      expect(result.distance).toBe(256);
    });

    it("uses custom threshold", () => {
      const template = makeTemplate("stripe", 0x00, 0b11111110);
      const queryBHash = new Uint8Array(32).fill(0xFF);
      const result = confirmBHashMatch(queryBHash, template, 40);
      expect(result.distance).toBe(32);
      expect(result.matched).toBe(true);
    });

    it("rejects invalid query hash lengths", () => {
      const template = makeTemplate("stripe", 0x00, 0xFF);
      expect(() => confirmBHashMatch(new Uint8Array(31), template)).toThrow(/expected 32-byte bHash/);
    });
  });

  describe("computeVisualSimScore", () => {
    it("returns 30 for high confidence + cross-origin", () => {
      const match: VisualSimMatch = {
        brandId: "google",
        brandName: "Google",
        confidence: "high",
        aHashDistance: 3,
        bHashDistance: 10,
      };
      expect(computeVisualSimScore(match, true)).toBe(30);
    });

    it("returns 25 for high confidence + same origin", () => {
      const match: VisualSimMatch = {
        brandId: "google",
        brandName: "Google",
        confidence: "high",
        aHashDistance: 3,
        bHashDistance: 10,
      };
      expect(computeVisualSimScore(match, false)).toBe(25);
    });

    it("returns 10 for low confidence (aHash only)", () => {
      const match: VisualSimMatch = {
        brandId: "paypal",
        brandName: "PayPal",
        confidence: "low",
        aHashDistance: 8,
        bHashDistance: 50,
      };
      expect(computeVisualSimScore(match, true)).toBe(10);
      expect(computeVisualSimScore(match, false)).toBe(10);
    });
  });
});
