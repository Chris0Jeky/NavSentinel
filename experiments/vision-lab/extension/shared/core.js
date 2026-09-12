/* NavSentinel Vision Lab • dependency-free policy kernel.
 * This is a new experimental kernel, NOT a port of NavSentinel's production CDS/NRS.
 * Observations are evidence, never authority. Registry scores are uncalibrated.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NSCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'vision-lab/1.0.0';
  const REGISTRY = Object.freeze({
    transparent_overlay: { label: 'Nearly invisible click surface', points: 40, group: 'overlay', category: 'Interaction', evidence: 'observed' },
    oversized_hit_area: { label: 'Oversized interactive layer', points: 25, group: 'overlay', category: 'Interaction', evidence: 'observed' },
    destination_mismatch: { label: 'Visible intent and destination differ', points: 35, group: 'intent', category: 'Navigation', evidence: 'correlated' },
    retargeted_click: { label: 'Target changed during activation', points: 40, group: 'intent', category: 'Interaction', evidence: 'observed' },
    no_fresh_gesture: { label: 'No recent intent for this consequence', points: 35, group: 'gesture', category: 'Navigation', evidence: 'observed' },
    synthetic_activation: { label: 'Activation was script-generated', points: 45, group: 'gesture', category: 'Navigation', evidence: 'observed' },
    rapid_window_swap: { label: 'Window changed between clicks', points: 75, group: 'gesture', category: 'Interaction', evidence: 'correlated' },
    cross_origin_credentials: { label: 'Password form targets another origin', points: 45, group: 'credentials', category: 'Credentials', evidence: 'observed' },
    insecure_credentials: { label: 'Password submission uses HTTP', points: 100, group: 'invariant', category: 'Credentials', evidence: 'observed', hard: true },
    untrusted_credentials: { label: 'Credential destination is not trusted', points: 35, group: 'credentials', category: 'Credentials', evidence: 'observed' },
    form_mutated: { label: 'Form destination changed after interaction', points: 40, group: 'intent', category: 'Credentials', evidence: 'observed' },
    lookalike_host: { label: 'Hostname resembles a different identity', points: 40, group: 'identity', category: 'Credentials', evidence: 'inferred' },
    clipboard_instruction: { label: 'Page asks for a verification command', points: 40, group: 'clipboard', category: 'ClickFix', evidence: 'correlated' },
    unsolicited_clipboard: { label: 'Unexpected clipboard-write intent', points: 35, group: 'gesture', category: 'ClickFix', evidence: 'observed' },
    shell_tainted: { label: 'Browser-tainted content targets a shell', points: 100, group: 'invariant', category: 'ClickFix', evidence: 'correlated', hard: true },
    redirect_chain: { label: 'Multiple destination changes', points: 30, group: 'redirect', category: 'Navigation', evidence: 'observed' },
    sensitive_upload: { label: 'Sensitive data would leave its workspace', points: 50, group: 'data', category: 'Data movement', evidence: 'observed' },
    agent_outside_scope: { label: 'Action is outside the agent contract', points: 45, group: 'scope', category: 'Agent conduct', evidence: 'observed' },
    sensitive_oauth: { label: 'Consent includes consequential permissions', points: 45, group: 'scope', category: 'Identity', evidence: 'observed' },
    forged_authority: { label: 'Untrusted surface attempted to grant authority', points: 100, group: 'invariant', category: 'Authority', evidence: 'observed', hard: true },
    stale_context: { label: 'Approval belongs to a different document', points: 100, group: 'invariant', category: 'Authority', evidence: 'observed', hard: true },
    expected_flow: { label: 'Matches an explicitly expected journey', points: -20, group: 'benign', category: 'Compatibility', evidence: 'correlated' },
    explicit_new_tab: { label: 'User explicitly requested a new tab', points: -20, group: 'benign', category: 'Compatibility', evidence: 'observed' },
    accessible_control: { label: 'Visible, named interaction target', points: -10, group: 'benign', category: 'Compatibility', evidence: 'observed' },
    same_origin: { label: 'Consequence stays on the current origin', points: -10, group: 'benign', category: 'Compatibility', evidence: 'observed' },
    unknown_evidence: { label: 'Available observation is incomplete', points: 0, group: 'uncertainty', category: 'Evidence', evidence: 'unknown' }
  });
  const ACTIONS = Object.freeze(['navigate', 'popup', 'overlay', 'credential-submit', 'clipboard-write', 'shell-paste', 'file-upload', 'oauth-consent', 'agent-action']);
  const DEFAULT_POLICY = Object.freeze({ mode: 'smart', navigationHosts: [], credentialHosts: [], attentionLimit: 3 });
  function boundedString(value, name, max = 256) {
    if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`Invalid ${name}`);
    return value;
  }
  function plainObject(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError(`Invalid ${name}`);
  }
  function safeUrl(value) {
    boundedString(value, 'URL', 2048);
    let url; try { url = new URL(value); } catch { throw new TypeError('Invalid URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Only credential-free HTTP(S) URLs are accepted');
    return url.href;
  }
  function origin(value) { try { return new URL(safeUrl(value)).origin; } catch { return '(unavailable)'; } }
  function host(value) { try { return new URL(safeUrl(value)).hostname; } catch { return ''; } }
  function normalizeHost(value) {
    boundedString(value, 'hostname', 253);
    if (/[\s/:?#@*]/.test(value)) throw new TypeError('Use one exact hostname, without a scheme, path or wildcard');
    const h = new URL(`https://${value}`).hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(h) || h.startsWith('.') || h.endsWith('.') || h.includes('..')) throw new TypeError('Invalid hostname');
    return h;
  }
  function normalizePolicy(policy = {}) {
    plainObject(policy, 'policy');
    const mode = policy.mode || 'smart';
    if (!['smart', 'strict', 'observe'].includes(mode)) throw new TypeError('Invalid policy mode');
    const list = key => {
      if (policy[key] === undefined) return [];
      if (!Array.isArray(policy[key]) || policy[key].length > 100) throw new TypeError(`Invalid ${key}`);
      return [...new Set(policy[key].map(normalizeHost))];
    };
    const attentionLimit = policy.attentionLimit === undefined ? 3 : policy.attentionLimit;
    if (!Number.isInteger(attentionLimit) || attentionLimit < 1 || attentionLimit > 10) throw new TypeError('Invalid attention limit');
    return { mode, navigationHosts: list('navigationHosts'), credentialHosts: list('credentialHosts'), attentionLimit };
  }
  function normalizeEvent(input) {
    plainObject(input, 'event');
    const allowed = ['id','journeyId','actor','action','source','destination','signals','context','evidence'];
    if (Object.keys(input).some(k => !allowed.includes(k))) throw new TypeError('Unknown event field (raw values are not accepted)');
    if (!ACTIONS.includes(input.action)) throw new TypeError('Unsupported action');
    if (!Array.isArray(input.signals) || input.signals.length > 32 || input.signals.some(x => typeof x !== 'string' || !Object.hasOwn(REGISTRY, x))) throw new TypeError('Unknown or invalid signal');
    const context = input.context || {};
    plainObject(context, 'context');
    if (Object.keys(context).some(k => !['tab','frame','document','navigation','actionId'].includes(k))) throw new TypeError('Unknown context field');
    const ctx = {};
    for (const key of ['tab', 'frame', 'document', 'navigation', 'actionId']) ctx[key] = boundedString(String(context[key] ?? (key === 'frame' ? '0' : 'demo')), `context.${key}`, 96);
    const evidence = input.evidence || 'fixture';
    if (!['fixture','sensor','declared'].includes(evidence)) throw new TypeError('Invalid evidence type');
    return {
      id: boundedString(input.id || 'event', 'id', 96),
      journeyId: boundedString(input.journeyId || 'session', 'journeyId', 96),
      actor: boundedString(input.actor || 'browser', 'actor', 96),
      action: input.action,
      source: safeUrl(input.source), destination: safeUrl(input.destination),
      signals: [...new Set(input.signals)].sort(), context: ctx, evidence
    };
  }
  function evaluate(input, rawPolicy = DEFAULT_POLICY) {
    const event = normalizeEvent(input), policy = normalizePolicy(rawPolicy);
    const contributions = event.signals.map(id => ({ id, ...REGISTRY[id] }));
    const destinationHost = host(event.destination);
    const credentialTrusted = policy.credentialHosts.includes(destinationHost);
    const navigationTrusted = policy.navigationHosts.includes(destinationHost);
    const effective = contributions.filter(c => !(c.id === 'untrusted_credentials' && credentialTrusted));
    const groups = {};
    for (const c of effective) groups[c.group] = (groups[c.group] || 0) + c.points;
    // Cap correlated groups. Benign metadata can mitigate, but never defeat a hard invariant.
    let sum = 0;
    for (const [group, value] of Object.entries(groups)) sum += group === 'benign' ? Math.max(-30, value) : Math.min(group === 'invariant' ? 100 : 75, value);
    const score = Math.max(0, Math.min(100, sum));
    const hard = effective.some(c => c.hard);
    const blockAt = policy.mode === 'strict' ? 55 : 70;
    const reviewAt = policy.mode === 'strict' ? 20 : 35;
    let decision = hard || score >= blockAt ? 'block' : score >= reviewAt ? 'review' : 'allow';
    if (event.signals.some(id => ['unknown_evidence','agent_outside_scope'].includes(id)) && decision === 'allow') decision = 'review';
    // Navigation trust only removes a low-confidence navigation review, not credential, scope or gesture constraints.
    if (navigationTrusted && event.action === 'navigate' && decision === 'review' && effective.every(c => ['redirect', 'benign'].includes(c.group))) decision = 'allow';
    const wouldDecide = decision;
    if (policy.mode === 'observe') decision = 'observe';
    const category = effective.find(c => c.hard)?.category || effective.filter(c => c.points > 0).sort((a,b) => b.points-a.points)[0]?.category || 'Compatibility';
    const headline = {block:'Consequence stopped', review:'A decision needs you', allow:'Intent preserved', observe:'Observed, not enforced'}[decision];
    return { version: VERSION, decision, wouldDecide, score, hard, category, headline, overridable: decision === 'review' && !hard,
      contributions, suppressed: contributions.filter(c => !effective.includes(c)).map(c => c.id),
      explanation: effective.filter(c=>c.points>0).map(c=>c.label), evidence: event.evidence,
      scoreMeaning: 'Heuristic points, not a probability or measured protection rate',
      coverage: event.evidence === 'fixture' ? 'Deterministic fixture evaluation only' : event.evidence === 'declared' ? 'Caller-declared evidence; not independently observed' : 'Bounded sensor observation; not a complete browser oracle'
    };
  }
  function publicReceipt(input, result, extra = {}) {
    const e = normalizeEvent(input);
    return { schema: 1, kernel: VERSION, id: e.id, journeyId: e.journeyId, actor: e.actor, action: e.action,
      source: origin(e.source), destination: origin(e.destination),
      decision: result.decision, wouldDecide: result.wouldDecide, score: result.score, hard: result.hard,
      category: result.category, signals: e.signals, evidence: e.evidence,
      quality: [...new Set(result.contributions.map(c=>c.evidence))],
      timestamp: typeof extra.timestamp === 'string' ? extra.timestamp : new Date().toISOString(),
      scenarioId: typeof extra.scenarioId === 'string' ? extra.scenarioId.slice(0,96) : null,
      sourceKind: ['fixture','live-extension','broker'].includes(extra.sourceKind) ? extra.sourceKind : 'fixture' };
  }
  function sameContext(a, b) {
    return JSON.stringify(normalizeEvent(a)) === JSON.stringify(normalizeEvent(b));
  }
  return Object.freeze({ VERSION, REGISTRY, ACTIONS, DEFAULT_POLICY, safeUrl, origin, host, normalizeHost, normalizeEvent, normalizePolicy, evaluate, publicReceipt, sameContext });
});
