import {
  addTrustedDomain,
  appendEvent,
  appendPromptOutcome,
  getCredentialSettings,
  getTrustedDomains,
  onSuiteSettingsChange,
  type CredMode
} from "../shared/storage";
import { computeCredentialRisk, getRegistrableDomain, normalizeHost, recalcSeverity } from "../shared/domain";
import { showToast } from "./ui_toast";
import { showCredentialModal } from "./credential_modal";
import {
  deriveCredentialPasteState,
  getCredentialReasonLines,
  isCrossSiteCredentialAction,
  shouldPromptCredentialSubmit
} from "./credential_guard_model";
import { analyzePageContent } from "./content_analyzer";
import { checkSRI } from "./sri_checker";

const allowNextSubmitUntil = new WeakMap<HTMLFormElement, number>();

// #227.5: the credential mode, cached synchronously so handleSubmit can decide
// whether to interpose BEFORE preventDefault. When the guard is disabled it must
// not interpose at all (no preventDefault, no synthetic resubmit). Primed once at
// init and kept current via the settings-change subscription; while it is still
// unknown, handleSubmit falls back to the async settings read.
// Note (R1 finding 6): an off->on flip has a one-submit propagation lag -- a
// submit fired before the settings-change event lands is not interposed on. The
// reverse (on->off) is always safe, and the lag is not attacker-forceable.
let cachedCredMode: CredMode | undefined;
void (async () => {
  try {
    cachedCredMode = (await getCredentialSettings()).mode;
  } catch {
    /* leave undefined; handleSubmit reads settings async until the cache primes */
  }
})();
onSuiteSettingsChange((s) => {
  cachedCredMode = s.credential.mode;
});

function nowMs(): number {
  return Date.now();
}

function markAllowNext(form: HTMLFormElement, ms: number): void {
  allowNextSubmitUntil.set(form, nowMs() + ms);
}

function consumeAllowNext(form: HTMLFormElement): boolean {
  const t = allowNextSubmitUntil.get(form);
  if (!t) return false;
  allowNextSubmitUntil.delete(form);
  return nowMs() <= t;
}

function isPasswordForm(form: HTMLFormElement): boolean {
  try {
    // Consider every password input the form can actually submit, not just the
    // first descendant. `form.querySelector` returns the first match in document
    // order, so a disabled-first decoy ("<input type=password disabled>" before a
    // real enabled field) made this return false and skipped the guard entirely.
    // We also include inputs associated via the `form=` attribute (declared
    // outside the form element) which `form.elements` exposes but a descendant
    // query misses. Union both sources for resilience across DOM implementations,
    // then require at least one ENABLED password field (#227.2).
    const seen = new Set<Element>();
    const collection = form.elements;
    if (collection) {
      for (let i = 0; i < collection.length; i++) {
        const el = collection.item(i);
        if (el) seen.add(el);
      }
    }
    form.querySelectorAll('input[type="password"]').forEach((el) => seen.add(el));
    return Array.from(seen).some(
      (el) => el instanceof HTMLInputElement && el.type === "password" && !el.disabled
    );
  } catch {
    return false;
  }
}

function resolveActionUrl(form: HTMLFormElement, submitter: HTMLElement | null): string {
  try {
    // requestSubmit(submitter) honors the submitter's formaction per the HTML
    // spec, so that is where the password is actually POSTed -- assess that
    // destination, not just the form's action. A submitter carrying the
    // formaction attribute (even empty, which the browser resolves to the current
    // document) overrides the form action; otherwise fall back to it (#227.1).
    const raw = (
      submitter?.hasAttribute("formaction")
        ? submitter.getAttribute("formaction") || ""
        : form.getAttribute("action") || ""
    ).trim();
    if (!raw || raw.toLowerCase().startsWith("javascript:")) return location.href;
    return new URL(raw, location.href).href;
  } catch {
    return location.href;
  }
}

function actionHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function registrableOf(url: string): string {
  const host = actionHost(url);
  return getRegistrableDomain(host) || host;
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function resumeSubmit(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
  opts?: { allowUnsafeFallback?: boolean }
): void {
  // requestSubmit re-dispatches the submit event; mark a one-shot bypass so our
  // own handler lets that re-entrant event through (and consumes it).
  // NOTE (#264): if requestSubmit no-ops on interactive constraint validation no
  // re-entrant submit fires to consume the token, so it lingers up to 5s --
  // tracked as a pre-existing follow-up (fix = a synchronous one-shot scope).
  markAllowNext(form, 5000);

  try {
    form.requestSubmit(submitter);
  } catch {
    // requestSubmit failed (e.g. the submit control was detached or re-associated
    // during the await window). Nothing was submitted, so revoke the one-shot
    // bypass.
    allowNextSubmitUntil.delete(form);
    // form.submit() ignores the submitter's formaction and always POSTs to
    // form.action, so when a formaction override was assessed (#227.1) falling
    // back would send credentials to an UNASSESSED destination. Fail closed and
    // tell the user instead of silently downgrading the target (R1 finding 1) --
    // UNLESS the caller assessed nothing (off mode / pre-assessment fail-open),
    // where blocking a disabled guard would be a regression (R2 L2).
    if (submitter?.hasAttribute("formaction") && !opts?.allowUnsafeFallback) {
      showToast({
        message: "The sign-in could not be completed safely (the submit control changed). Please try again.",
        timeoutMs: 8000
      });
      return;
    }
    try {
      form.submit();
    } catch (e) {
      console.warn("[NavSentinel] form submit fallback failed:", e);
    }
  }
}

// #227.3 (TOCTOU): the action is assessed once, then the handler awaits storage
// writes and the modal. Page JS can mutate the form action during that window so
// requestSubmit() POSTs the password to a destination that was never assessed
// (the modal showed the old one). Re-resolve immediately before resuming and, if
// the origin no longer matches what we evaluated, block instead of submitting --
// the user can resubmit to trigger a fresh evaluation. Returns true when the
// submit was blocked (caller must NOT resume).
async function blockIfActionMutated(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
  assessedActionUrl: string,
  pageSite: string,
  pageUrl: string
): Promise<boolean> {
  const liveActionUrl = resolveActionUrl(form, submitter);
  // A submitter whose form association changed during the prompt (detached, or
  // re-pointed via the form= attribute) would make requestSubmit target a
  // different form/formaction than we assessed -- treat that as a destination
  // change (R1 finding 1/2).
  const submitterReassociated =
    (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) &&
    submitter.form !== form;
  // Not a mutation if the resolved destination is byte-identical AND the submitter
  // still belongs to this form.
  if (!submitterReassociated && liveActionUrl === assessedActionUrl) return false;
  // Compare at the granularity the risk model uses (registrable domain), plus an
  // explicit https->http downgrade, so a benign same-site www->api action
  // resolution is not hard-blocked while a cross-site swap or scheme downgrade
  // still is (R1 finding 4). Opaque-host schemes (data:/blob:/mailto:) all map to
  // an empty registrable, so an opaque->opaque swap must NOT be treated as equal
  // (R2 L1) -- the byte-identical fast path above already lets a truly-unchanged
  // opaque action through.
  const liveReg = registrableOf(liveActionUrl);
  const assessedReg = registrableOf(assessedActionUrl);
  const sameRegistrable = liveReg !== "" && assessedReg !== "" && liveReg === assessedReg;
  const downgraded = isHttpsUrl(assessedActionUrl) && !isHttpsUrl(liveActionUrl);
  if (!submitterReassociated && sameRegistrable && !downgraded) return false;

  const liveHost = actionHost(liveActionUrl);
  await appendEvent({
    kind: "cred_submit_prompt",
    site: pageSite,
    url: pageUrl,
    destHost: liveHost,
    extra: { error: "action_mutated_during_prompt", liveDestHost: liveHost }
  }).catch((err) => {
    console.warn("[NavSentinel] event log append failed (action_mutated):", err);
  });
  showToast({
    message: "This form's destination changed after the security check, so the submission was blocked. Resubmit to re-check it.",
    timeoutMs: 10000
  });
  return true;
}

async function handleSubmit(evt: SubmitEvent): Promise<void> {
  const form = evt.target;
  if (!(form instanceof HTMLFormElement) || !isPasswordForm(form)) return;
  if (consumeAllowNext(form)) return;

  // #227.5: when the guard is disabled, do not interpose at all. Only interpose
  // (preventDefault + synthetic resubmit) when the cached mode is not "off". While
  // the cache is unknown we fall through and re-check via the async settings read.
  if (cachedCredMode === "off") return;

  const submitter = evt.submitter;

  evt.preventDefault();
  evt.stopImmediatePropagation();

  // #227.4: once the native submit is cancelled, an unexpected error before a
  // decision must fail OPEN (resume) rather than silently brick a legitimate
  // login. `decided` records that we have already resumed or intentionally
  // blocked so the catch never double-submits and never overrides an intentional
  // block.
  let decided = false;
  // Hoisted so the fail-open catch can re-check the destination before resuming
  // (R2 M1). undefined until resolved inside the try.
  let assessedActionUrl: string | undefined;

  try {
    const cfg = await getCredentialSettings();
    if (cfg.mode === "off") {
      decided = true;
      // Guard disabled -> never block; allow the form.submit() fallback (R2 L2).
      resumeSubmit(form, submitter, { allowUnsafeFallback: true });
      return;
    }

    const trusted = await getTrustedDomains();
    assessedActionUrl = resolveActionUrl(form, submitter);
    const risk = computeCredentialRisk({
      pageUrl: location.href,
      actionUrl: assessedActionUrl,
      trustedDomains: trusted,
      config: cfg
    });

    // Content fingerprinting: boost risk when page content signals phishing.
    // Skip entirely for trusted domains -- they have already been allowlisted
    // by the user and content analysis would only produce false positives.
    // #227.4: a hostile page controls the DOM these analyzers read, so isolate
    // their failures -- a thrown analyzer must drop its signal, never escape to
    // the fail-open catch and bypass the prompt.
    if (!risk.page.isTrusted) {
      try {
        const pageHost = normalizeHost(location.hostname);
        const pageDomain = getRegistrableDomain(pageHost) || pageHost;
        const contentAnalysis = analyzePageContent(document, pageDomain);
        if (contentAnalysis.score > 0) {
          const boost = Math.min(contentAnalysis.score, 100 - risk.score);
          risk.score = Math.min(100, risk.score + boost);
          for (let i = 0; i < contentAnalysis.reasons.length; i++) {
            risk.reasons.push({ code: "CONTENT_FP", label: contentAnalysis.reasons[i] ?? "" });
          }
          risk.severity = recalcSeverity(risk.score);
        }
      } catch (err) {
        console.warn("[NavSentinel] content analysis failed (signal skipped):", err);
      }
    }

    // SRI awareness: flag missing subresource integrity on credential pages.
    // Skip entirely for trusted domains -- consistent with content analysis above.
    if (!risk.page.isTrusted) {
      try {
        const sriAnalysis = checkSRI(document, location.href, location.origin);
        if (sriAnalysis.score !== 0) {
          risk.score = Math.max(0, Math.min(100, risk.score + sriAnalysis.score));
          const sriCode = sriAnalysis.score > 0 ? "SRI_MISSING_ON_CREDENTIAL_PAGE" : "SRI_PRESENT_ON_CREDENTIAL_PAGE";
          for (let i = 0; i < sriAnalysis.reasons.length; i++) {
            risk.reasons.push({ code: sriCode, label: sriAnalysis.reasons[i] ?? "" });
          }
          risk.severity = recalcSeverity(risk.score);
        }
      } catch (err) {
        console.warn("[NavSentinel] SRI check failed (signal skipped):", err);
      }
    }

    const crossSite = isCrossSiteCredentialAction(risk);
    const isHttpsOk = risk.page.isHttps && risk.action.isHttps;
    const pageSite = risk.page.registrableDomain || risk.page.host;

    if (
      !shouldPromptCredentialSubmit({
        mode: cfg.mode,
        riskScore: risk.score,
        pageTrusted: risk.page.isTrusted,
        actionTrusted: risk.action.isTrusted,
        isHttpsOk,
        crossSite,
        config: cfg
      })
    ) {
      // P5-B1 (#236): record the silently-passed credential form so the journal
      // and tuning corpus capture safe-form ground truth, not just blocked
      // submits. Await the SW-backed append before resubmitting so the normal
      // form navigation cannot tear down the content-script context first.
      decided = true;
      await appendEvent({
        kind: "cred_form_evaluated",
        site: pageSite,
        url: risk.page.url,
        destHost: risk.action.registrableDomain || risk.action.host,
        score: risk.score,
        reasons: risk.reasons.map((r) => r.code),
        extra: { severity: risk.severity, crossSite, threshold: cfg.mediumRiskThreshold }
      }).catch((err) => {
        console.warn("[NavSentinel] event log append failed (cred_form_evaluated):", err);
      });
      // Even on the silent path the destination must not have moved during the
      // (short) append window before we resume (#227.3).
      if (await blockIfActionMutated(form, submitter, assessedActionUrl, pageSite, risk.page.url)) {
        return;
      }
      resumeSubmit(form, submitter);
      return;
    }

    // #227.4: guard the pre-modal log so a storage hiccup here cannot throw the
    // whole handler into the fail-open catch (which would resume without ever
    // showing the prompt).
    await appendEvent({
      kind: "cred_submit_prompt",
      site: pageSite,
      url: risk.page.url,
      destHost: risk.action.registrableDomain || risk.action.host,
      score: risk.score,
      reasons: risk.reasons.map((r) => r.code),
      extra: { severity: risk.severity }
    }).catch((err) => {
      console.warn("[NavSentinel] event log append failed (cred_submit_prompt):", err);
    });

    const choice = await showCredentialModal({
      title: "Credential submit blocked",
      subtitle: "You are about to submit a form containing a password field. Verify the domain before proceeding.",
      kv: [
        { k: "Page", v: risk.page.registrableDomain || risk.page.host || "(unknown)" },
        { k: "Destination", v: risk.action.registrableDomain || risk.action.host || "(unknown)" },
        { k: "Risk score", v: `${risk.score} (${risk.severity})` }
      ],
      reasons: getCredentialReasonLines(risk.reasons),
      actions: [
        { id: "cancel", label: "Cancel", kind: "danger" },
        { id: "proceed_once", label: "Proceed once", kind: "primary" },
        ...(!risk.page.isTrusted && risk.page.registrableDomain
          ? [{ id: "trust_site", label: `Trust ${risk.page.registrableDomain}`, kind: "primary" as const }]
          : []),
        ...(risk.action.registrableDomain &&
        risk.action.registrableDomain !== risk.page.registrableDomain &&
        !risk.action.isTrusted
          ? [
              {
                id: "trust_dest",
                label: `Trust destination ${risk.action.registrableDomain}`,
                kind: "primary" as const
              }
            ]
          : [])
      ],
      outsideAction: "cancel"
    });

    const credDomain = risk.page.registrableDomain || risk.page.host;
    const credReasons = risk.reasons.map((r) => r.code);
    // Capture the action (destination) HOST so cred records carry the same
    // source->dest pairing as nav records (which store the hostname), preserving
    // any subdomain that triggered the prompt — a same-registrable-domain host
    // mismatch (login.x.com -> secure.x.com) would be hidden by registrableDomain
    // (P5-C1 / #238 consistency fix).
    const credDest = risk.action.host || risk.action.registrableDomain || undefined;

    if (choice === "cancel") {
      decided = true;
      void appendPromptOutcome({
        domain: credDomain,
        ...(credDest ? { destDomain: credDest } : {}),
        type: "cred",
        score: risk.score,
        outcome: "cancel",
        reasons: credReasons
      }).catch((e) => { console.warn("[NavSentinel] prompt outcome append failed (cancel):", e); });
      return;
    }

    // Terminal decision. Re-check the destination FIRST -- a mutation-blocked
    // submit must NOT log a completed allow/trust or widen trust to a destination
    // the user only saw pre-mutation (R2 L4) -- and locking `decided` here keeps a
    // trust-write fault from fail-opening past this gate (R1-3). The user approved
    // the destination they were shown; refuse if page JS swapped it (#227.3).
    decided = true;
    if (await blockIfActionMutated(form, submitter, assessedActionUrl, pageSite, risk.page.url)) {
      return;
    }

    if (choice === "trust_site" || choice === "trust_dest") {
      void appendPromptOutcome({
        domain: credDomain,
        ...(credDest ? { destDomain: credDest } : {}),
        type: "cred",
        score: risk.score,
        outcome: "trust",
        reasons: credReasons
      }).catch((e) => { console.warn("[NavSentinel] prompt outcome append failed (trust):", e); });
    } else {
      void appendPromptOutcome({
        domain: credDomain,
        ...(credDest ? { destDomain: credDest } : {}),
        type: "cred",
        score: risk.score,
        outcome: "allow_once",
        reasons: credReasons
      }).catch((e) => { console.warn("[NavSentinel] prompt outcome append failed (allow_once):", e); });
    }

    // Trust writes are .catch-guarded so a failed write is non-fatal (log and
    // proceed with the approved submit) and cannot unwind to the fail-open catch.
    if (choice === "trust_site" && risk.page.registrableDomain) {
      await addTrustedDomain(risk.page.registrableDomain).catch((e) => {
        console.warn("[NavSentinel] addTrustedDomain failed (trust_site):", e);
      });
      void appendEvent({
        kind: "cred_trust_domain",
        site: risk.page.registrableDomain,
        url: risk.page.url
      }).catch((e) => { console.warn("[NavSentinel] event log append failed (cred_trust_domain):", e); });
    }

    if (choice === "trust_dest" && risk.action.registrableDomain) {
      await addTrustedDomain(risk.action.registrableDomain).catch((e) => {
        console.warn("[NavSentinel] addTrustedDomain failed (trust_dest):", e);
      });
      void appendEvent({
        kind: "cred_trust_domain",
        site: risk.action.registrableDomain,
        url: risk.page.url,
        destHost: risk.action.registrableDomain
      }).catch((e) => { console.warn("[NavSentinel] event log append failed (cred_trust_domain/dest):", e); });
    }

    resumeSubmit(form, submitter);

    await appendEvent({
      kind: "cred_submit_allow_once",
      site: pageSite,
      url: risk.page.url,
      destHost: risk.action.registrableDomain || risk.action.host,
      score: risk.score,
      reasons: risk.reasons.map((r) => r.code),
      extra: { choice }
    }).catch((err) => {
      console.warn("[NavSentinel] event log append failed (cred_submit_allow_once):", err);
    });
  } catch (e) {
    // #227.4: fail open on an unexpected pre-decision error -- a transient storage
    // or service-worker fault must not permanently brick a legitimate login.
    // Analyzer exceptions are contained above, so this path is reached only by
    // infra faults we do not control, not by attacker-shaped DOM. `decided`
    // guards against double-submit and against overriding an intentional block.
    if (!decided) {
      // R2 M1: if we got far enough to assess a destination, re-check it before
      // failing open so a post-assessment fault concurrent with a page-JS action
      // swap cannot resume the POST to an unassessed destination. If nothing was
      // assessed yet (settings/trust read rejected) the fault is not
      // attacker-reachable; fail open (allow the fallback) to avoid bricking.
      try {
        if (
          assessedActionUrl !== undefined &&
          (await blockIfActionMutated(
            form,
            submitter,
            assessedActionUrl,
            normalizeHost(location.hostname),
            location.href
          ))
        ) {
          // mutated during the fault -> do not resume
        } else {
          resumeSubmit(
            form,
            submitter,
            assessedActionUrl === undefined ? { allowUnsafeFallback: true } : undefined
          );
        }
      } catch {
        resumeSubmit(form, submitter, { allowUnsafeFallback: true });
      }
    }
    try {
      await appendEvent({
        kind: "cred_submit_prompt",
        site: normalizeHost(location.hostname),
        url: location.href,
        extra: { error: e instanceof Error ? e.message : String(e) }
      });
    } catch (logErr) {
      console.warn("[NavSentinel] event log append failed (cred_submit_prompt/error):", logErr, "original:", e);
    }
  }
}

async function handlePaste(evt: ClipboardEvent): Promise<void> {
  try {
    const cfg = await getCredentialSettings();
    if (cfg.mode === "off" || !cfg.warnOnPaste) return;

    const t = evt.target;
    if (!(t instanceof HTMLInputElement)) return;
    if ((t.getAttribute("type") || "").toLowerCase() !== "password") return;

    const trusted = await getTrustedDomains();
    const host = normalizeHost(location.hostname);
    const reg = getRegistrableDomain(host);
    const pasteState = deriveCredentialPasteState(location.href, trusted);
    if (!pasteState.shouldWarn) return;

    showToast({
      message: `You pasted into a password field on an untrusted domain: ${pasteState.siteLabel}.`,
      timeoutMs: 10000,
      actions: [
        {
          label: reg ? `Trust ${reg}` : "Trust this site",
          onClick: async () => {
            try {
              if (reg) await addTrustedDomain(reg);
              await appendEvent({ kind: "cred_trust_domain", site: reg || host, url: location.href });
            } catch (e) {
              console.warn("[NavSentinel] event log append failed (cred_trust_domain/paste):", e);
            }
          }
        }
      ]
    });

    await appendEvent({ kind: "cred_paste_warn", site: pasteState.siteLabel, url: location.href });
  } catch (e) {
    console.warn("[NavSentinel] credential paste handler failed:", e);
  }
}

document.addEventListener("submit", (e) => void handleSubmit(e), true);
document.addEventListener("paste", (e) => void handlePaste(e), true);
