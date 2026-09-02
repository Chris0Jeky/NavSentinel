/**
 * Shared contract for short-lived extension-origin security decisions.
 *
 * Exact URLs are accepted only at the service-worker boundary. Pending records
 * retain SHA-256 fingerprints for authorization and origins for display; raw
 * paths, queries, and fragments never enter session persistence.
 */

export const PENDING_DECISION_TTL_MS = 30_000;
export const PENDING_DECISION_MAX_PER_TAB = 8;
export const PENDING_DECISION_MAX_URL_LENGTH = 8_192;
export const PENDING_DECISION_MAX_ACTIONS = 3;
export const PENDING_DECISION_MAX_DOCUMENT_ID_LENGTH = 128;
export const PENDING_DECISION_MAX_SIGNALS = 8;

/** Finite display codes only; never accept page-provided free-form text here. */
export const PENDING_DECISION_SIGNAL_CODES = ["cross_site", "NRS-high"] as const;

export const NAVIGATION_DECISION_REASONS = [
  "navigation-blocked",
  "navigation-rollback",
  "navigation-forward-offer",
  "blank-target-blocked",
  "allow-route-suggestion",
] as const;

export const CREDENTIAL_DECISION_REASONS = [
  "credential-submit-blocked",
  "credential-paste-risk",
] as const;

export const NAVIGATION_DECISION_ACTIONS = ["proceed-once", "allow-route"] as const;
export const CREDENTIAL_DECISION_ACTIONS = [
  "proceed-once",
  "trust-source",
  "trust-destination",
] as const;

export type NavigationDecisionReason = (typeof NAVIGATION_DECISION_REASONS)[number];
export type CredentialDecisionReason = (typeof CREDENTIAL_DECISION_REASONS)[number];
export type NavigationDecisionAction = (typeof NAVIGATION_DECISION_ACTIONS)[number];
export type CredentialDecisionAction = (typeof CREDENTIAL_DECISION_ACTIONS)[number];
export type PendingDecisionAction = NavigationDecisionAction | CredentialDecisionAction;
export type PendingDecisionSignalCode = (typeof PENDING_DECISION_SIGNAL_CODES)[number];

/** Context sourced from MessageSender/tab state, never from page-provided semantics. */
export interface PendingDecisionVerifiedContext {
  tabId: number;
  windowId: number;
  frameId: number;
  documentId: string;
  sourceUrl: string;
  topUrl: string;
}

/** Minimum verified context required to list decisions in extension-origin UI. */
export interface PendingDecisionVerifiedTabContext {
  tabId: number;
  windowId: number;
  topUrl: string;
}

interface PendingDecisionSemanticsBase {
  destinationUrl: string;
  score?: number;
  signals?: readonly PendingDecisionSignalCode[];
}

export interface PendingNavigationDecisionSemantics extends PendingDecisionSemanticsBase {
  kind: "navigation";
  reason: NavigationDecisionReason;
  actions: readonly NavigationDecisionAction[];
}

export interface PendingCredentialDecisionSemantics extends PendingDecisionSemanticsBase {
  kind: "credential";
  reason: CredentialDecisionReason;
  actions: readonly CredentialDecisionAction[];
}

export type PendingDecisionSemantics =
  | PendingNavigationDecisionSemantics
  | PendingCredentialDecisionSemantics;

interface PendingDecisionRecordBase {
  id: string;
  deliveryToken: string;
  tabId: number;
  windowId: number;
  frameId: number;
  documentId: string;
  sourceUrlHash: string;
  topUrlHash: string;
  destinationUrlHash: string;
  sourceOrigin: string;
  topOrigin: string;
  destinationOrigin: string;
  createdAt: number;
  expiresAt: number;
  score?: number;
  signals?: readonly PendingDecisionSignalCode[];
}

export interface PendingNavigationDecision extends PendingDecisionRecordBase {
  kind: "navigation";
  reason: NavigationDecisionReason;
  actions: readonly NavigationDecisionAction[];
}

export interface PendingCredentialDecision extends PendingDecisionRecordBase {
  kind: "credential";
  reason: CredentialDecisionReason;
  actions: readonly CredentialDecisionAction[];
}

export type PendingDecision = PendingNavigationDecision | PendingCredentialDecision;

const NAVIGATION_REASON_SET = new Set<string>(NAVIGATION_DECISION_REASONS);
const CREDENTIAL_REASON_SET = new Set<string>(CREDENTIAL_DECISION_REASONS);
const NAVIGATION_ACTIONS_BY_REASON: Record<NavigationDecisionReason, ReadonlySet<string>> = {
  "navigation-blocked": new Set(["proceed-once", "allow-route"]),
  "navigation-rollback": new Set(["proceed-once"]),
  "navigation-forward-offer": new Set(["proceed-once"]),
  "blank-target-blocked": new Set(["proceed-once", "allow-route"]),
  "allow-route-suggestion": new Set(["allow-route"]),
};
const CREDENTIAL_ACTIONS_BY_REASON: Record<CredentialDecisionReason, ReadonlySet<string>> = {
  "credential-submit-blocked": new Set([
    "proceed-once",
    "trust-source",
    "trust-destination",
  ]),
  "credential-paste-risk": new Set(["trust-source"]),
};
const ALL_ACTION_SET = new Set<string>([
  ...NAVIGATION_DECISION_ACTIONS,
  ...CREDENTIAL_DECISION_ACTIONS,
]);
const PENDING_DECISION_SIGNAL_SET = new Set<string>(PENDING_DECISION_SIGNAL_CODES);
const OPAQUE_VALUE_RE = /^[A-Za-z0-9_-]{22,128}$/;
const DOCUMENT_ID_RE = /^[A-Za-z0-9_-]+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const VERIFIED_IDENTITY_FIELDS = [
  "tabId",
  "windowId",
  "frameId",
  "documentId",
  "sourceUrl",
  "topUrl",
  "sourceUrlHash",
  "topUrlHash",
  "destinationUrlHash",
  "sourceOrigin",
  "topOrigin",
  "destinationOrigin",
  "id",
  "deliveryToken",
  "createdAt",
  "expiresAt",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBrowserId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isDocumentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= PENDING_DECISION_MAX_DOCUMENT_ID_LENGTH &&
    DOCUMENT_ID_RE.test(value)
  );
}

/** True only for a canonical, complete HTTP(S) URL within the input bound. */
export function isExactHttpUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > PENDING_DECISION_MAX_URL_LENGTH
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.href === value;
  } catch {
    return false;
  }
}

export function getExactHttpOrigin(url: string): string {
  if (!isExactHttpUrl(url)) throw new TypeError("Expected an exact HTTP(S) URL");
  return new URL(url).origin;
}

function isHttpOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

export function isOpaquePendingDecisionValue(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_VALUE_RE.test(value);
}

export function isSha256Fingerprint(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

export function isPendingDecisionAction(value: unknown): value is PendingDecisionAction {
  return typeof value === "string" && ALL_ACTION_SET.has(value);
}

export function parsePendingDecisionVerifiedContext(
  value: unknown,
): PendingDecisionVerifiedContext | null {
  if (
    !isRecord(value) ||
    !isBrowserId(value.tabId) ||
    !isBrowserId(value.windowId) ||
    !isBrowserId(value.frameId) ||
    !isDocumentId(value.documentId) ||
    !isExactHttpUrl(value.sourceUrl) ||
    !isExactHttpUrl(value.topUrl)
  ) {
    return null;
  }
  return {
    tabId: value.tabId,
    windowId: value.windowId,
    frameId: value.frameId,
    documentId: value.documentId,
    sourceUrl: value.sourceUrl,
    topUrl: value.topUrl,
  };
}

export function parsePendingDecisionVerifiedTabContext(
  value: unknown,
): PendingDecisionVerifiedTabContext | null {
  if (
    !isRecord(value) ||
    !isBrowserId(value.tabId) ||
    !isBrowserId(value.windowId) ||
    !isExactHttpUrl(value.topUrl)
  ) {
    return null;
  }
  return { tabId: value.tabId, windowId: value.windowId, topUrl: value.topUrl };
}

function parseActions(value: unknown, allowed: ReadonlySet<string>): PendingDecisionAction[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > PENDING_DECISION_MAX_ACTIONS
  ) {
    return null;
  }
  const actions: PendingDecisionAction[] = [];
  const seen = new Set<string>();
  for (const action of value) {
    if (typeof action !== "string" || !allowed.has(action) || seen.has(action)) return null;
    seen.add(action);
    actions.push(action as PendingDecisionAction);
  }
  return actions;
}

function parseSignals(value: unknown): PendingDecisionSignalCode[] | null {
  if (!Array.isArray(value) || value.length > PENDING_DECISION_MAX_SIGNALS) return null;
  const signals: PendingDecisionSignalCode[] = [];
  const seen = new Set<string>();
  for (const signal of value) {
    if (
      typeof signal !== "string" ||
      !PENDING_DECISION_SIGNAL_SET.has(signal) ||
      seen.has(signal)
    ) {
      return null;
    }
    seen.add(signal);
    signals.push(signal as PendingDecisionSignalCode);
  }
  return signals;
}

interface ParsedSemanticFields {
  kind: "navigation" | "credential";
  reason: NavigationDecisionReason | CredentialDecisionReason;
  actions: PendingDecisionAction[];
  score?: number;
  signals?: PendingDecisionSignalCode[];
}

function parseSemanticFields(value: Record<string, unknown>): ParsedSemanticFields | null {
  if (
    value.score !== undefined &&
    (!Number.isInteger(value.score) || (value.score as number) < 0 || (value.score as number) > 100)
  ) {
    return null;
  }
  const signals = value.signals === undefined ? undefined : parseSignals(value.signals);
  if (value.signals !== undefined && signals === null) return null;

  let kind: ParsedSemanticFields["kind"];
  let reason: ParsedSemanticFields["reason"];
  let actions: PendingDecisionAction[] | null;
  if (value.kind === "navigation" && typeof value.reason === "string" && NAVIGATION_REASON_SET.has(value.reason)) {
    const navigationReason = value.reason as NavigationDecisionReason;
    kind = "navigation";
    reason = navigationReason;
    actions = parseActions(value.actions, NAVIGATION_ACTIONS_BY_REASON[navigationReason]);
  } else if (
    value.kind === "credential" &&
    typeof value.reason === "string" &&
    CREDENTIAL_REASON_SET.has(value.reason)
  ) {
    const credentialReason = value.reason as CredentialDecisionReason;
    kind = "credential";
    reason = credentialReason;
    actions = parseActions(value.actions, CREDENTIAL_ACTIONS_BY_REASON[credentialReason]);
  } else {
    return null;
  }
  if (!actions) return null;

  return {
    kind,
    reason,
    actions,
    ...(value.score !== undefined ? { score: value.score as number } : {}),
    ...(signals !== undefined && signals !== null ? { signals } : {}),
  };
}

/** Parse page-provided semantics, explicitly rejecting verified/generated identity fields. */
export function parsePendingDecisionSemantics(value: unknown): PendingDecisionSemantics | null {
  if (!isRecord(value) || VERIFIED_IDENTITY_FIELDS.some((field) => field in value)) return null;
  if (!isExactHttpUrl(value.destinationUrl)) return null;
  const parsed = parseSemanticFields(value);
  if (!parsed) return null;
  return { ...parsed, destinationUrl: value.destinationUrl } as PendingDecisionSemantics;
}

/** Parse a persisted, URL-free decision and return only known bounded fields. */
export function parsePendingDecision(value: unknown, now: number): PendingDecision | null {
  if (!isRecord(value)) return null;
  const semantics = parseSemanticFields(value);
  if (
    !semantics ||
    !isOpaquePendingDecisionValue(value.id) ||
    !isOpaquePendingDecisionValue(value.deliveryToken) ||
    value.id === value.deliveryToken ||
    !isBrowserId(value.tabId) ||
    !isBrowserId(value.windowId) ||
    !isBrowserId(value.frameId) ||
    !isDocumentId(value.documentId) ||
    !isSha256Fingerprint(value.sourceUrlHash) ||
    !isSha256Fingerprint(value.topUrlHash) ||
    !isSha256Fingerprint(value.destinationUrlHash) ||
    !isHttpOrigin(value.sourceOrigin) ||
    !isHttpOrigin(value.topOrigin) ||
    !isHttpOrigin(value.destinationOrigin) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.expiresAt) ||
    value.createdAt > now ||
    value.expiresAt - value.createdAt !== PENDING_DECISION_TTL_MS
  ) {
    return null;
  }
  return {
    ...semantics,
    id: value.id,
    deliveryToken: value.deliveryToken,
    tabId: value.tabId,
    windowId: value.windowId,
    frameId: value.frameId,
    documentId: value.documentId,
    sourceUrlHash: value.sourceUrlHash,
    topUrlHash: value.topUrlHash,
    destinationUrlHash: value.destinationUrlHash,
    sourceOrigin: value.sourceOrigin,
    topOrigin: value.topOrigin,
    destinationOrigin: value.destinationOrigin,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  } as PendingDecision;
}

export function clonePendingDecision(decision: PendingDecision): PendingDecision {
  return {
    ...decision,
    actions: [...decision.actions],
    ...(decision.signals !== undefined ? { signals: [...decision.signals] } : {}),
  } as PendingDecision;
}

export function pendingDecisionScopeKey(
  decision: Pick<PendingDecision, "documentId" | "frameId" | "kind">,
): string {
  return `${decision.documentId}\u0000${decision.frameId}\u0000${decision.kind}`;
}

export interface PendingDecisionCreateMessage {
  type: "ns-pending-decision-create";
  semantics: unknown;
}

export interface PendingDecisionListMessage {
  type: "ns-pending-decision-list";
}

export interface PendingDecisionConsumeMessage {
  type: "ns-pending-decision-consume";
  id: unknown;
  deliveryToken: unknown;
  action: unknown;
}

export type PendingDecisionRuntimeMessage =
  | PendingDecisionCreateMessage
  | PendingDecisionListMessage
  | PendingDecisionConsumeMessage;

export type PendingDecisionRuntimeOperation = "create" | "list" | "consume";

export type PendingDecisionRuntimeFailureStatus =
  | "unauthorized"
  | "invalid-request"
  | "no-active-http-tab"
  | "missing"
  | "expired"
  | "mismatch"
  | "action-not-allowed"
  | "context-changed"
  | "delivery-failed"
  | "rejected-capacity"
  | "unavailable";

interface PendingDecisionViewBase {
  id: string;
  deliveryToken: string;
  sourceOrigin: string;
  topOrigin: string;
  destinationOrigin: string;
  createdAt: number;
  expiresAt: number;
  score?: number;
  signals?: readonly PendingDecisionSignalCode[];
}

/** URL-free, bounded capability view exposed only to extension-origin UI. */
export interface PendingNavigationDecisionView extends PendingDecisionViewBase {
  kind: "navigation";
  reason: NavigationDecisionReason;
  actions: readonly NavigationDecisionAction[];
}

/** URL-free, bounded capability view exposed only to extension-origin UI. */
export interface PendingCredentialDecisionView extends PendingDecisionViewBase {
  kind: "credential";
  reason: CredentialDecisionReason;
  actions: readonly CredentialDecisionAction[];
}

export type PendingDecisionView =
  | PendingNavigationDecisionView
  | PendingCredentialDecisionView;

export interface PendingDecisionRuntimeFailureResponse {
  ok: false;
  operation: PendingDecisionRuntimeOperation;
  status: PendingDecisionRuntimeFailureStatus;
}

export interface PendingDecisionCreateSuccessResponse {
  ok: true;
  operation: "create";
  status: "created";
  id: string;
  expiresAt: number;
  replacedDecisionId?: string;
}

export interface PendingDecisionListSuccessResponse {
  ok: true;
  operation: "list";
  status: "missing" | "pending";
  tabId: number;
  windowId: number;
  decisions: PendingDecisionView[];
}

export interface PendingDecisionConsumeSuccessResponse {
  ok: true;
  operation: "consume";
  status: "consumed";
  kind: PendingDecision["kind"];
  action: PendingDecisionAction;
}

/** Strict URL-free request for one exact document to release its ephemeral URL. */
export interface PendingDecisionReleaseMessage {
  type: "ns-pending-decision-release";
  id: string;
  action: PendingDecisionAction;
}

/** Best-effort receipt after the worker has opened the authorized destination. */
export interface PendingDecisionOpenedMessage {
  type: "ns-pending-decision-opened";
  id: string;
  action: PendingDecisionAction;
}

export type PendingDecisionDeliveryMessage =
  | PendingDecisionReleaseMessage
  | PendingDecisionOpenedMessage;

export type PendingDecisionDeliveryResponse =
  | { ok: true; status: "released"; destinationUrl: string }
  | { ok: true; status: "acknowledged" }
  | { ok: false; status: "rejected" };

export type PendingDecisionRuntimeResponse =
  | PendingDecisionRuntimeFailureResponse
  | PendingDecisionCreateSuccessResponse
  | PendingDecisionListSuccessResponse
  | PendingDecisionConsumeSuccessResponse;

export function isPendingDecisionRuntimeMessage(
  value: unknown,
): value is PendingDecisionRuntimeMessage {
  if (!isRecord(value)) return false;
  return (
    value.type === "ns-pending-decision-create" ||
    value.type === "ns-pending-decision-list" ||
    value.type === "ns-pending-decision-consume"
  );
}

export function toPendingDecisionView(decision: PendingDecision): PendingDecisionView {
  const common = {
    id: decision.id,
    deliveryToken: decision.deliveryToken,
    sourceOrigin: decision.sourceOrigin,
    topOrigin: decision.topOrigin,
    destinationOrigin: decision.destinationOrigin,
    createdAt: decision.createdAt,
    expiresAt: decision.expiresAt,
    ...(decision.score !== undefined ? { score: decision.score } : {}),
    ...(decision.signals !== undefined ? { signals: [...decision.signals] } : {}),
  };
  if (decision.kind === "navigation") {
    return {
      ...common,
      kind: decision.kind,
      reason: decision.reason,
      actions: [...decision.actions],
    };
  }
  return {
    ...common,
    kind: decision.kind,
    reason: decision.reason,
    actions: [...decision.actions],
  };
}
