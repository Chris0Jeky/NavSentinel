import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import manifest from "../extension/manifest.json";
import { loadBrandTemplates, resetLoader } from "../extension/src/shared/visual_sim_loader";
import { getTemplates, isLoaded, loadTemplates } from "../extension/src/shared/visual_sim_templates";

describe("brand_templates.json", () => {
  const templatePath = resolve(__dirname, "../extension/public/brand_templates.json");
  let templateData: { version: number; generated: string; templates: Array<{ id: string; displayName: string; aHash: number[]; bHash: number[]; version: number }> };

  beforeEach(() => {
    loadTemplates([]);
    templateData = JSON.parse(readFileSync(templatePath, "utf-8"));
  });

  it("has valid JSON structure", () => {
    expect(templateData.version).toBe(1);
    expect(templateData.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(templateData.templates)).toBe(true);
    expect(templateData.templates.length).toBeGreaterThan(0);
  });

  it("contains at least 40 brands", () => {
    expect(templateData.templates.length).toBeGreaterThanOrEqual(40);
  });

  it("each template has valid aHash (8 bytes) and bHash (32 bytes)", () => {
    for (const tmpl of templateData.templates) {
      expect(tmpl.id).toBeTruthy();
      expect(tmpl.displayName).toBeTruthy();
      expect(tmpl.aHash).toHaveLength(8);
      expect(tmpl.bHash).toHaveLength(32);
      expect(tmpl.aHash.every((b: number) => b >= 0 && b <= 255)).toBe(true);
      expect(tmpl.bHash.every((b: number) => b >= 0 && b <= 255)).toBe(true);
      expect(tmpl.version).toBeGreaterThan(0);
    }
  });

  it("no duplicate brand IDs", () => {
    const ids = templateData.templates.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("no duplicate aHashes (each brand has unique visual signature)", () => {
    const hashes = templateData.templates.map(t => JSON.stringify(t.aHash));
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(hashes.length);
  });

  it("templates can be loaded into the matcher", () => {
    const templates = templateData.templates.map(raw => ({
      id: raw.id,
      displayName: raw.displayName,
      aHash: new Uint8Array(raw.aHash),
      bHash: new Uint8Array(raw.bHash),
      version: raw.version,
    }));
    loadTemplates(templates);
    expect(isLoaded()).toBe(true);
    expect(getTemplates().length).toBe(templateData.templates.length);
  });

  it("file size is under 500KB budget", () => {
    const size = Buffer.byteLength(readFileSync(templatePath));
    expect(size).toBeLessThan(500 * 1024);
  });
});

describe("visual_sim_loader", () => {
  beforeEach(() => {
    resetLoader();
    loadTemplates([]);
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes brand_templates.json as a web-accessible resource", () => {
    expect(manifest.web_accessible_resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resources: expect.arrayContaining(["brand_templates.json"]),
          matches: expect.arrayContaining(["<all_urls>"]),
        }),
      ])
    );
  });

  it("retries after a transient template load failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: 1,
          generated: "2026-05-16",
          templates: [
            {
              id: "example",
              displayName: "Example",
              aHash: new Array(8).fill(1),
              bHash: new Array(32).fill(2),
              version: 1,
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadBrandTemplates()).resolves.toBe(false);
    await expect(loadBrandTemplates()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getTemplates()).toHaveLength(1);
    expect(getTemplates()[0]!.id).toBe("example");
  });
});
