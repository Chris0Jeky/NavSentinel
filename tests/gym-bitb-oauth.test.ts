// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePageContent } from "../extension/src/content/content_analyzer";
import {
  isCrossSiteCredentialAction,
  shouldPromptCredentialSubmit,
} from "../extension/src/content/credential_guard_model";
import { computeCredentialRisk, getRegistrableDomain } from "../extension/src/shared/domain";
import type { CredentialSettings } from "../extension/src/shared/storage";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trusted = ["google.com"];
const config: CredentialSettings = {
  mode: "smart",
  promptOnUntrustedDomain: true,
  promptOnMediumRisk: true,
  mediumRiskThreshold: 40,
  blockHttpPasswordSubmit: true,
  warnOnPaste: true,
  similarity: { enabled: true, maxDistance: 2 },
};

function load(name: string): Document {
  return new DOMParser().parseFromString(readFileSync(resolve(root, "gym", name), "utf8"), "text/html");
}

function pageUrlOf(doc: Document): string {
  const href = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  if (!href) throw new Error("fixture missing canonical");
  return new URL(href).href;
}

function actionUrlOf(doc: Document, pageUrl: string): string {
  const action = doc.querySelector("form")?.getAttribute("action");
  if (!action) throw new Error("fixture missing form action");
  return new URL(action, pageUrl).href;
}

function assess(name: string) {
  const doc = load(name);
  const pageUrl = pageUrlOf(doc);
  const actionUrl = actionUrlOf(doc, pageUrl);
  const domain = getRegistrableDomain(new URL(pageUrl).hostname);
  const content = analyzePageContent(doc, domain);
  const risk = computeCredentialRisk({ pageUrl, actionUrl, trustedDomains: trusted, config });
  const prompt = shouldPromptCredentialSubmit({
    mode: config.mode,
    riskScore: risk.score,
    pageTrusted: risk.page.isTrusted,
    actionTrusted: risk.action.isTrusted,
    isHttpsOk: risk.page.isHttps && risk.action.isHttps,
    crossSite: isCrossSiteCredentialAction(risk),
    config,
  });
  return { content, prompt };
}

describe("gym/bitb-oauth-window.html and gym/bitb-first-party-window.html", () => {
  it("treats gym/bitb-oauth-window.html as deceptive and gym/bitb-first-party-window.html as not", () => {
    const attack = assess("bitb-oauth-window.html");
    const benign = assess("bitb-first-party-window.html");

    expect(attack.content.brandMismatch).toBe(true);
    expect(attack.content.score).toBeGreaterThan(0);
    expect(attack.prompt).toBe(true);

    expect(benign.content.brandMismatch).toBe(false);
    expect(benign.content.score).toBe(0);
    expect(benign.prompt).toBe(false);
  });
});
