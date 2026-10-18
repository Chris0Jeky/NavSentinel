// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isCrossSiteCredentialAction,
  shouldPromptCredentialSubmit,
} from "../extension/src/content/credential_guard_model";
import { computeCredentialRisk } from "../extension/src/shared/domain";
import type { CredentialSettings } from "../extension/src/shared/storage";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trusted = ["paypal.com"];
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

function assess(name: string) {
  const doc = load(name);
  const href = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  const action = doc.querySelector("form")?.getAttribute("action");
  if (!href || !action) throw new Error("fixture missing canonical or action");
  const pageUrl = new URL(href).href;
  const actionUrl = new URL(action, pageUrl).href;
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
  return { risk, prompt };
}

describe("gym/homograph-mixed-script-login.html and gym/homograph-real-paypal-login.html", () => {
  it("treats gym/homograph-mixed-script-login.html as deceptive and gym/homograph-real-paypal-login.html as not", () => {
    const attack = assess("homograph-mixed-script-login.html");
    const benign = assess("homograph-real-paypal-login.html");
    const attackCodes = attack.risk.reasons.map((reason) => reason.code);
    const benignCodes = benign.risk.reasons.map((reason) => reason.code);

    expect(attackCodes).toContain("PUNYCODE_HOST");
    expect(attack.risk.severity).not.toBe("none");
    expect(attack.prompt).toBe(true);

    expect(benignCodes).not.toContain("PUNYCODE_HOST");
    expect(benignCodes).not.toContain("MIXED_SCRIPT_HOST");
    expect(benign.risk.severity).toBe("none");
    expect(benign.prompt).toBe(false);
  });
});
