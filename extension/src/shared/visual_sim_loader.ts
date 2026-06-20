/**
 * Visual Similarity Template Loader (P4-01 W3-03)
 *
 * Loads the pre-computed brand template database from the extension bundle.
 * Called once on first use (lazy initialization). Templates are stored as
 * JSON with numeric arrays that get converted to Uint8Array at load time.
 */

import { loadTemplates } from "./visual_sim_templates";
import type { BrandTemplate } from "./visual_sim_types";

interface RawTemplate {
  id: string;
  displayName: string;
  aHash: number[];
  bHash: number[];
  version: number;
}

interface TemplateFile {
  version: number;
  templates: RawTemplate[];
}

let _loadPromise: Promise<boolean> | null = null;

export function loadBrandTemplates(): Promise<boolean> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = doLoad().then((loaded) => {
    if (!loaded) {
      _loadPromise = null;
    }
    return loaded;
  });
  return _loadPromise;
}

async function doLoad(): Promise<boolean> {
  try {
    const url = chrome.runtime.getURL("brand_templates.json");
    const response = await fetch(url);
    if (!response.ok) return false;

    const data: TemplateFile = await response.json();
    if (!data.templates || !Array.isArray(data.templates)) return false;

    const templates: BrandTemplate[] = data.templates.map((raw) => ({
      id: raw.id,
      displayName: raw.displayName,
      aHash: new Uint8Array(raw.aHash),
      bHash: new Uint8Array(raw.bHash),
      version: raw.version,
    }));

    loadTemplates(templates);
    return true;
  } catch {
    return false;
  }
}

export function resetLoader(): void {
  _loadPromise = null;
}
