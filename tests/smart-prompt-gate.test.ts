import { describe, expect, it } from "vitest";
import {
  TRUST_TIER_KNOWN_BAD,
  TRUST_TIER_TOP_SITE,
  TRUST_TIER_UNKNOWN,
} from "../extension/src/shared/top_sites";
import {
  isKnownIdpHost,
  isKnownPaymentOr3dsHost,
  looksLikeOAuthUrl,
  shouldSuppressSmartBlankPrompt,
  type SmartPromptSuppressionInput,
} from "../extension/src/content/smart_prompt_gate";

const baseInput = (overrides: Partial<SmartPromptSuppressionInput> = {}): SmartPromptSuppressionInput => ({
  mode: "smart",
  isBlankAnchor: true,
  isAllowed: false,
  explicitNewTab: false,
  cds: 0,
  cdsReasons: [],
  nrs: 35,
  nrsFactors: ["nrs_new_tab_window", "nrs_fast_attempt", "nrs_user_activation_active"],
  blockThreshold: 70,
  pointerDownTrusted: true,
  clickTrusted: true,
  keyboardActivation: false,
  timeSincePointerdownMs: 120,
  destHost: "app.example.com",
  destHref: "https://app.example.com/dashboard",
  sameOrganization: true,
  oauthRedirectMismatch: false,
  oauthOpenerManipulation: false,
  trustTier: TRUST_TIER_UNKNOWN,
  ...overrides,
});

describe("known Smart-mode benign context helpers", () => {
  it("recognizes common IdP hosts and subdomains", () => {
    expect(isKnownIdpHost("accounts.google.com")).toBe(true);
    expect(isKnownIdpHost("acme.okta.com")).toBe(true);
    expect(isKnownIdpHost("tenant.eu.auth0.com")).toBe(true);
    expect(isKnownIdpHost("login.microsoftonline.com")).toBe(true);
    expect(isKnownIdpHost("evil-okta.com")).toBe(false);
  });

  it("recognizes OAuth URLs only when path and query both indicate OAuth", () => {
    expect(looksLikeOAuthUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=abc")).toBe(true);
    expect(looksLikeOAuthUrl("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?response_type=code")).toBe(true);
    expect(looksLikeOAuthUrl("https://login.live.com/oauth20_authorize.srf?client_id=abc&response_type=code")).toBe(true);
    expect(looksLikeOAuthUrl("https://accounts.google.com/login?continue=/dashboard")).toBe(false);
    expect(looksLikeOAuthUrl("not-a-url")).toBe(false);
  });

  it("recognizes curated payment hosts without trusting arbitrary 3DS labels", () => {
    expect(isKnownPaymentOr3dsHost("checkout.stripe.com")).toBe(true);
    expect(isKnownPaymentOr3dsHost("3ds.stripe.com")).toBe(true);
    expect(isKnownPaymentOr3dsHost("cardinalcommerce.com")).toBe(true);
    expect(isKnownPaymentOr3dsHost("secure3ds.bank.example")).toBe(false);
    expect(isKnownPaymentOr3dsHost("evil3ds.example")).toBe(false);
    expect(isKnownPaymentOr3dsHost("3dsecure-attacker.example")).toBe(false);
    expect(isKnownPaymentOr3dsHost("paypal-secure.example.com")).toBe(false);
  });
});

describe("shouldSuppressSmartBlankPrompt", () => {
  it("suppresses same-organization blank-anchor prompts with a short active gesture and no CDS risk", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput())).toBe(true);
  });

  it("suppresses same-organization blank-anchor prompts with only low no-name CDS risk", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      cds: 15,
      cdsReasons: ["no_accessible_name"],
      nrs: 50,
    }))).toBe(true);
  });

  it("suppresses known IdP OAuth prompts when OAuth mismatch and opener manipulation are absent", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      destHost: "accounts.google.com",
      destHref: "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc",
      sameOrganization: false,
      nrs: 55,
      nrsFactors: ["nrs_new_tab_window", "nrs_cross_site", "nrs_fast_attempt", "nrs_user_activation_active"],
    }))).toBe(true);
  });

  it("suppresses recognized payment or 3DS prompts", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      destHost: "checkout.stripe.com",
      destHref: "https://checkout.stripe.com/pay/cs_test",
      sameOrganization: false,
      nrs: 55,
      nrsFactors: ["nrs_new_tab_window", "nrs_cross_site", "nrs_fast_attempt", "nrs_user_activation_active"],
    }))).toBe(true);
  });

  it("does not suppress strict mode, non-blank, allowlisted, or explicit new-tab paths", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({ mode: "strict" }))).toBe(false);
    expect(shouldSuppressSmartBlankPrompt(baseInput({ isBlankAnchor: false }))).toBe(false);
    expect(shouldSuppressSmartBlankPrompt(baseInput({ isAllowed: true }))).toBe(false);
    expect(shouldSuppressSmartBlankPrompt(baseInput({ explicitNewTab: true }))).toBe(false);
  });

  it("does not suppress when CDS found attack-shaped risk", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({ cds: 35 }))).toBe(false);
    expect(shouldSuppressSmartBlankPrompt(baseInput({ cdsReasons: ["intent_mismatch_under_interactive"] }))).toBe(false);
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      cds: 15,
      cdsReasons: ["no_accessible_name"],
      sameOrganization: false,
    }))).toBe(false);
  });

  it("does not suppress when final NRS reaches the active block threshold", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      nrs: 70,
      nrsFactors: ["nrs_new_tab_window", "nrs_fast_attempt", "nrs_user_activation_active", "nrs_clickfix_active"],
    }))).toBe(false);
  });

  it("does not suppress attack-grade NRS factors even below the block threshold", () => {
    const attackFactors = [
      "nrs_clickfix_active",
      "nrs_known_bad_domain",
      "nrs_js_behavior_suspicious",
      "nrs_pushstate_abuse",
      "nrs_redirect_chain_depth",
      "nrs_redirect_via_known_redirector",
      "nrs_domain_repeat_offender",
      "nrs_nav_anomaly",
      "nrs_double_click_hijack",
      "nrs_multiple_attempts",
      "nrs_csp_weakness",
    ];

    for (const factor of attackFactors) {
      expect(shouldSuppressSmartBlankPrompt(baseInput({
        nrs: 45,
        nrsFactors: ["nrs_new_tab_window", factor],
        trustTier: factor === "nrs_known_bad_domain" ? TRUST_TIER_KNOWN_BAD : TRUST_TIER_UNKNOWN,
      })), factor).toBe(false);
    }
  });

  it("suppresses filtered top-site blank prompts with only lone low-risk heuristics", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      cds: 15,
      cdsReasons: ["no_accessible_name"],
      nrs: 50,
      nrsFactors: ["nrs_new_tab_window", "nrs_fast_attempt", "nrs_user_activation_active"],
      sameOrganization: false,
      destHost: "github.com",
      destHref: "https://github.com/features",
      trustTier: TRUST_TIER_TOP_SITE,
    }))).toBe(true);
  });

  it("suppresses filtered top-site blank prompts with only the weaker minimal_accessible_name signal", () => {
    // minimal_accessible_name contributes a lower CDS (+8) than no_accessible_name (+15);
    // the top-site low-CDS allowance intentionally covers it. This pins that lenient
    // policy so a future CDS/threshold change cannot silently flip it.
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      cds: 8,
      cdsReasons: ["minimal_accessible_name"],
      nrs: 50,
      nrsFactors: ["nrs_new_tab_window", "nrs_fast_attempt", "nrs_user_activation_active"],
      sameOrganization: false,
      destHost: "github.com",
      destHref: "https://github.com/features",
      trustTier: TRUST_TIER_TOP_SITE,
    }))).toBe(true);
  });

  it("does not suppress top-site prompts when high-confidence attack reasons are present", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      cds: 35,
      cdsReasons: ["intent_mismatch_under_interactive"],
      nrs: 55,
      nrsFactors: ["nrs_new_tab_window"],
      sameOrganization: false,
      destHost: "github.com",
      trustTier: TRUST_TIER_TOP_SITE,
    }))).toBe(false);
  });

  it("does not suppress without a recent captured pointer gesture", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({ timeSincePointerdownMs: undefined }))).toBe(false);
    expect(shouldSuppressSmartBlankPrompt(baseInput({ timeSincePointerdownMs: 1501 }))).toBe(false);
  });

  it("suppresses trusted keyboard activation without a pointerdown", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      keyboardActivation: true,
      pointerDownTrusted: false,
      cds: 5,
      cdsReasons: ["no_accessible_name", "keyboard_activation"],
      nrs: 25,
      timeSincePointerdownMs: undefined,
    }))).toBe(true);
  });

  it("does not suppress untrusted pointer or click events", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({ pointerDownTrusted: false }))).toBe(false);
    expect(shouldSuppressSmartBlankPrompt(baseInput({ clickTrusted: false }))).toBe(false);
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      keyboardActivation: true,
      pointerDownTrusted: false,
      clickTrusted: false,
      timeSincePointerdownMs: undefined,
    }))).toBe(false);
  });

  it("does not suppress IdP-shaped prompts when OAuth risk flags are active", () => {
    const idp = baseInput({
      destHost: "accounts.google.com",
      destHref: "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc",
      sameOrganization: false,
    });

    expect(shouldSuppressSmartBlankPrompt({ ...idp, oauthRedirectMismatch: true })).toBe(false);
    expect(shouldSuppressSmartBlankPrompt({ ...idp, oauthOpenerManipulation: true })).toBe(false);
  });

  it("does not suppress unrelated cross-site blank anchors", () => {
    expect(shouldSuppressSmartBlankPrompt(baseInput({
      destHost: "login.unknown.example",
      destHref: "https://login.unknown.example/start",
      sameOrganization: false,
    }))).toBe(false);
  });
});
