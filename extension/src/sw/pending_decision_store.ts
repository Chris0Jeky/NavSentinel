import {
  PENDING_DECISION_MAX_PER_TAB,
  PENDING_DECISION_TTL_MS,
  clonePendingDecision,
  getExactHttpOrigin,
  isOpaquePendingDecisionValue,
  isPendingDecisionAction,
  isSha256Fingerprint,
  parsePendingDecision,
  parsePendingDecisionConsumeContext,
  parsePendingDecisionSemantics,
  parsePendingDecisionVerifiedContext,
  parsePendingDecisionVerifiedTabContext,
  pendingDecisionScopeKey,
  type PendingDecision,
  type PendingDecisionAction,
  type PendingDecisionConsumeContext,
  type PendingDecisionSemantics,
  type PendingDecisionVerifiedContext,
  type PendingDecisionVerifiedTabContext,
} from "../shared/pending_decision";

export const PENDING_DECISION_STORAGE_KEY = "ns_sw:pendingDecision";

const STORAGE_VERSION = 2;
const OPAQUE_BYTES = 16;
const MAX_OPAQUE_GENERATION_ATTEMPTS = 8;

export interface PendingDecisionSessionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface PendingDecisionStoreDependencies {
  storage: PendingDecisionSessionStorage;
  now: () => number;
  generateOpaqueValue: () => string;
  fingerprintUrl: (exactUrl: string) => Promise<string>;
}

export interface PendingDecisionConsumeAuthorization {
  id: string;
  deliveryToken: string;
  action: PendingDecisionAction;
}

export type PendingDecisionCreateStatus =
  | {
      status: "created";
      decision: PendingDecision;
      replacedDecisionId?: string;
      evictedDecisionId?: string;
    }
  | { status: "rejected-capacity" }
  | { status: "context-changed" };

export type PendingDecisionListStatus =
  | { status: "missing"; decisions: [] }
  | { status: "pending"; decisions: PendingDecision[] };

export type PendingDecisionConsumeStatus =
  | { status: "missing" }
  | { status: "expired" }
  | { status: "mismatch" }
  | { status: "action-not-allowed" }
  | { status: "consumed"; decision: PendingDecision; action: PendingDecisionAction };

export type PendingDecisionLifecycleRemovalStatus =
  | { status: "missing"; removedCount: 0 }
  | { status: "removed"; removedCount: number };

interface StoredPendingDecisions {
  version: typeof STORAGE_VERSION;
  byTab: Record<string, PendingDecision[]>;
}

interface FingerprintedContext {
  sourceUrlHash: string;
  topUrlHash: string;
  sourceOrigin: string;
  topOrigin: string;
}

interface FingerprintedConsumeContext extends FingerprintedContext {
  destinationUrlHash: string;
  destinationOrigin: string;
}

function defaultSessionStorage(): PendingDecisionSessionStorage {
  return {
    get: (key) => chrome.storage.session.get(key),
    set: (items) => chrome.storage.session.set(items),
  };
}

function defaultOpaqueValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(OPAQUE_BYTES));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function defaultFingerprintUrl(exactUrl: string): Promise<string> {
  const encoded = new TextEncoder().encode(exactUrl);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTabId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function serializedValuesEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function sortRecords(records: readonly PendingDecision[]): PendingDecision[] {
  return [...records].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

function cloneRecordMap(
  source: ReadonlyMap<number, readonly PendingDecision[]>,
): Map<number, PendingDecision[]> {
  const clone = new Map<number, PendingDecision[]>();
  for (const [tabId, records] of source) {
    clone.set(tabId, records.map(clonePendingDecision));
  }
  return clone;
}

export function hasPendingDecisions(
  result: PendingDecisionListStatus,
): result is Extract<PendingDecisionListStatus, { status: "pending" }> {
  return result.status === "pending";
}

export function didConsumePendingDecision(
  result: PendingDecisionConsumeStatus,
): result is Extract<PendingDecisionConsumeStatus, { status: "consumed" }> {
  return result.status === "consumed";
}

/**
 * URL-minimized, session-backed decision broker.
 *
 * Mutations are serialized and persistence is awaited before success is
 * returned. Raw exact URLs are fingerprinted before records enter this store.
 * `storage.session` has no per-record TTL: an expired, inert record can remain
 * until the next create/list/hydrate/tab-lifecycle operation. Such residue is
 * deliberately limited to origins, hashes, and opaque IDs—never paths, queries,
 * fragments, or page content. Runtime integration may add an alarm-driven
 * physical prune if product policy requires deletion at the exact deadline.
 */
export class PendingDecisionStore {
  private readonly storage: PendingDecisionSessionStorage;
  private readonly now: () => number;
  private readonly generateOpaqueValue: () => string;
  private readonly fingerprintUrl: (exactUrl: string) => Promise<string>;
  private recordsByTab = new Map<number, PendingDecision[]>();
  private hydratePromise: Promise<void> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(dependencies: Partial<PendingDecisionStoreDependencies> = {}) {
    this.storage = dependencies.storage ?? defaultSessionStorage();
    this.now = dependencies.now ?? Date.now;
    this.generateOpaqueValue = dependencies.generateOpaqueValue ?? defaultOpaqueValue;
    this.fingerprintUrl = dependencies.fingerprintUrl ?? defaultFingerprintUrl;
  }

  hydrate(): Promise<void> {
    if (this.hydratePromise) return this.hydratePromise;

    const attempt = this.runSerialized(async () => {
      const stored = await this.storage.get(PENDING_DECISION_STORAGE_KEY);
      const raw = stored[PENDING_DECISION_STORAGE_KEY];
      const now = this.now();
      const restored = new Map<number, PendingDecision[]>();

      if (raw !== undefined && isRecord(raw) && raw.version === STORAGE_VERSION && isRecord(raw.byTab)) {
        for (const [rawTabId, rawRecords] of Object.entries(raw.byTab)) {
          const tabId = Number(rawTabId);
          if (!isTabId(tabId) || String(tabId) !== rawTabId || !Array.isArray(rawRecords)) continue;

          const newestByScope = new Map<string, PendingDecision>();
          for (const rawRecord of rawRecords) {
            const record = parsePendingDecision(rawRecord, now);
            if (!record || record.tabId !== tabId || record.expiresAt <= now) continue;
            const scope = pendingDecisionScopeKey(record);
            const previous = newestByScope.get(scope);
            if (!previous || record.createdAt >= previous.createdAt) newestByScope.set(scope, record);
          }

          const candidates = [...newestByScope.values()];
          const topFrames = candidates
            .filter((record) => record.frameId === 0)
            .sort((left, right) => right.createdAt - left.createdAt);
          const childFrames = candidates
            .filter((record) => record.frameId !== 0)
            .sort((left, right) => right.createdAt - left.createdAt);
          const selected = [
            ...topFrames.slice(0, PENDING_DECISION_MAX_PER_TAB),
            ...childFrames.slice(0, Math.max(0, PENDING_DECISION_MAX_PER_TAB - topFrames.length)),
          ].slice(0, PENDING_DECISION_MAX_PER_TAB);
          if (selected.length > 0) restored.set(tabId, sortRecords(selected));
        }
      }

      this.recordsByTab = restored;
      if (raw !== undefined) {
        const sanitized = this.serialize();
        if (!serializedValuesEqual(raw, sanitized)) {
          await this.storage.set({ [PENDING_DECISION_STORAGE_KEY]: sanitized });
        }
      }
    });

    this.hydratePromise = attempt;
    void attempt.catch(() => {
      if (this.hydratePromise === attempt) this.hydratePromise = null;
    });
    return attempt;
  }

  async create(
    verifiedContext: PendingDecisionVerifiedContext,
    untrustedSemantics: PendingDecisionSemantics,
    isLifecycleCurrent: () => boolean = () => true,
  ): Promise<PendingDecisionCreateStatus> {
    const context = parsePendingDecisionVerifiedContext(verifiedContext);
    const semantics = parsePendingDecisionSemantics(untrustedSemantics);
    if (!context) throw new TypeError("Invalid verified pending-decision context");
    if (!semantics) throw new TypeError("Invalid pending-decision semantics");
    await this.hydrate();

    return this.runSerialized(async () => {
      if (!isLifecycleCurrent()) return { status: "context-changed" };
      // Hashing stays inside the mutation queue. If it ran before enqueueing, a
      // slow older create could replace a faster newer one, or complete after
      // tabs.onRemoved cleanup and resurrect state for a dead tab.
      const fingerprinted = await this.fingerprintVerifiedContext(context);
      const destinationUrlHash = await this.checkedFingerprint(semantics.destinationUrl);
      const destinationOrigin = getExactHttpOrigin(semantics.destinationUrl);
      // A lifecycle event can arrive while the async digests are running. The
      // final guard is inside the serialized mutation, immediately before any
      // in-memory or persisted state is changed.
      if (!isLifecycleCurrent()) return { status: "context-changed" };
      const before = cloneRecordMap(this.recordsByTab);
      const createdAt = this.now();
      const active = (this.recordsByTab.get(context.tabId) ?? []).filter(
        (record) => record.expiresAt > createdAt,
      );
      const scope = pendingDecisionScopeKey({
        documentId: context.documentId,
        frameId: context.frameId,
        kind: semantics.kind,
      });
      const existingIndex = active.findIndex((record) => pendingDecisionScopeKey(record) === scope);

      let evictedDecisionId: string | undefined;
      if (existingIndex < 0 && active.length >= PENDING_DECISION_MAX_PER_TAB) {
        if (context.frameId !== 0) return { status: "rejected-capacity" };
        let evictionIndex = -1;
        for (let index = 0; index < active.length; index++) {
          const candidate = active[index];
          if (
            candidate &&
            candidate.frameId !== 0 &&
            (evictionIndex < 0 ||
              candidate.createdAt < (active[evictionIndex]?.createdAt ?? Number.POSITIVE_INFINITY))
          ) {
            evictionIndex = index;
          }
        }
        // A correctly wired top-navigation listener removes the prior document's
        // decisions. If that lifecycle cleanup was missed across a worker
        // restart, stale top-document records must not permanently consume every
        // reserved slot. Never evict a record from the current top document/hash.
        if (evictionIndex < 0) {
          for (let index = 0; index < active.length; index++) {
            const candidate = active[index];
            if (
              candidate &&
              candidate.frameId === 0 &&
              (candidate.documentId !== context.documentId ||
                candidate.topUrlHash !== fingerprinted.topUrlHash) &&
              (evictionIndex < 0 ||
                candidate.createdAt < (active[evictionIndex]?.createdAt ?? Number.POSITIVE_INFINITY))
            ) {
              evictionIndex = index;
            }
          }
        }
        if (evictionIndex < 0) return { status: "rejected-capacity" };
        evictedDecisionId = active[evictionIndex]?.id;
        active.splice(evictionIndex, 1);
      }

      const usedOpaqueValues = new Set<string>();
      for (const records of this.recordsByTab.values()) {
        for (const decision of records) {
          usedOpaqueValues.add(decision.id);
          usedOpaqueValues.add(decision.deliveryToken);
        }
      }
      const id = this.nextOpaqueValue(usedOpaqueValues);
      usedOpaqueValues.add(id);
      const deliveryToken = this.nextOpaqueValue(usedOpaqueValues);
      const decision = {
        kind: semantics.kind,
        reason: semantics.reason,
        actions: [...semantics.actions],
        ...(semantics.score !== undefined ? { score: semantics.score } : {}),
        ...(semantics.signals !== undefined ? { signals: [...semantics.signals] } : {}),
        id,
        deliveryToken,
        tabId: context.tabId,
        windowId: context.windowId,
        frameId: context.frameId,
        documentId: context.documentId,
        ...fingerprinted,
        destinationUrlHash,
        destinationOrigin,
        createdAt,
        expiresAt: createdAt + PENDING_DECISION_TTL_MS,
      } as PendingDecision;

      const replaced = existingIndex >= 0 ? active[existingIndex] : undefined;
      if (existingIndex >= 0) active[existingIndex] = decision;
      else active.push(decision);
      this.recordsByTab.set(context.tabId, sortRecords(active));

      try {
        await this.persist();
      } catch (error) {
        this.recordsByTab = before;
        throw error;
      }

      return {
        status: "created",
        decision: clonePendingDecision(decision),
        ...(replaced ? { replacedDecisionId: replaced.id } : {}),
        ...(evictedDecisionId ? { evictedDecisionId } : {}),
      };
    });
  }

  async listForVerifiedTab(
    verifiedTab: PendingDecisionVerifiedTabContext,
  ): Promise<PendingDecisionListStatus> {
    const context = parsePendingDecisionVerifiedTabContext(verifiedTab);
    if (!context) throw new TypeError("Invalid verified pending-decision tab context");
    await this.hydrate();
    const topUrlHash = await this.checkedFingerprint(context.topUrl);
    const topOrigin = getExactHttpOrigin(context.topUrl);

    return this.runSerialized(async () => {
      const current = this.recordsByTab.get(context.tabId);
      if (!current) return { status: "missing", decisions: [] };

      const now = this.now();
      const active = current.filter((record) => record.expiresAt > now);
      if (active.length !== current.length) {
        await this.replaceTabWithRollback(context.tabId, active);
      }
      const matching = active
        .filter(
          (record) =>
            record.windowId === context.windowId &&
            record.topUrlHash === topUrlHash &&
            record.topOrigin === topOrigin,
        )
        .sort((left, right) => right.createdAt - left.createdAt)
        .map(clonePendingDecision);
      if (matching.length === 0) return { status: "missing", decisions: [] };
      return { status: "pending", decisions: matching };
    });
  }

  async consume(
    verifiedContextAndDestination: PendingDecisionConsumeContext,
    authorization: PendingDecisionConsumeAuthorization,
  ): Promise<PendingDecisionConsumeStatus> {
    const context = parsePendingDecisionConsumeContext(verifiedContextAndDestination);
    if (
      !context ||
      !isOpaquePendingDecisionValue(authorization.id) ||
      !isOpaquePendingDecisionValue(authorization.deliveryToken) ||
      !isPendingDecisionAction(authorization.action)
    ) {
      throw new TypeError("Invalid pending-decision consume request");
    }
    await this.hydrate();
    const fingerprinted = await this.fingerprintConsumeContext(context);

    return this.runSerialized(async () => {
      const records = this.recordsByTab.get(context.tabId);
      if (!records) return { status: "missing" };
      const index = records.findIndex((record) => record.id === authorization.id);
      if (index < 0) return { status: "missing" };
      const decision = records[index];
      if (!decision) return { status: "missing" };
      if (decision.expiresAt <= this.now()) {
        await this.removeRecordWithRollback(context.tabId, index);
        return { status: "expired" };
      }
      if (
        decision.deliveryToken !== authorization.deliveryToken ||
        decision.windowId !== context.windowId ||
        decision.frameId !== context.frameId ||
        decision.documentId !== context.documentId ||
        decision.sourceUrlHash !== fingerprinted.sourceUrlHash ||
        decision.topUrlHash !== fingerprinted.topUrlHash ||
        decision.destinationUrlHash !== fingerprinted.destinationUrlHash ||
        decision.sourceOrigin !== fingerprinted.sourceOrigin ||
        decision.topOrigin !== fingerprinted.topOrigin ||
        decision.destinationOrigin !== fingerprinted.destinationOrigin
      ) {
        return { status: "mismatch" };
      }
      if (!(decision.actions as readonly PendingDecisionAction[]).includes(authorization.action)) {
        return { status: "action-not-allowed" };
      }

      await this.removeRecordWithRollback(context.tabId, index);
      return {
        status: "consumed",
        decision: clonePendingDecision(decision),
        action: authorization.action,
      };
    });
  }

  /** Awaited cleanup for top-frame navigation/tab removal; not an authorization lookup. */
  async removeForTabLifecycle(tabId: number): Promise<PendingDecisionLifecycleRemovalStatus> {
    if (!isTabId(tabId)) throw new TypeError("Invalid pending-decision tab ID");
    await this.hydrate();
    return this.runSerialized(async () => {
      const records = this.recordsByTab.get(tabId);
      if (!records) return { status: "missing", removedCount: 0 };
      const before = cloneRecordMap(this.recordsByTab);
      this.recordsByTab.delete(tabId);
      try {
        await this.persist();
      } catch (error) {
        this.recordsByTab = before;
        throw error;
      }
      return { status: "removed", removedCount: records.length };
    });
  }

  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async checkedFingerprint(exactUrl: string): Promise<string> {
    const fingerprint = await this.fingerprintUrl(exactUrl);
    if (!isSha256Fingerprint(fingerprint)) {
      throw new Error("URL fingerprint dependency did not return a SHA-256 hex digest");
    }
    return fingerprint;
  }

  private async fingerprintVerifiedContext(
    context: PendingDecisionVerifiedContext,
  ): Promise<FingerprintedContext> {
    const [sourceUrlHash, topUrlHash] = await Promise.all([
      this.checkedFingerprint(context.sourceUrl),
      this.checkedFingerprint(context.topUrl),
    ]);
    return {
      sourceUrlHash,
      topUrlHash,
      sourceOrigin: getExactHttpOrigin(context.sourceUrl),
      topOrigin: getExactHttpOrigin(context.topUrl),
    };
  }

  private async fingerprintConsumeContext(
    context: PendingDecisionConsumeContext,
  ): Promise<FingerprintedConsumeContext> {
    const [sourceUrlHash, topUrlHash, destinationUrlHash] = await Promise.all([
      this.checkedFingerprint(context.sourceUrl),
      this.checkedFingerprint(context.topUrl),
      this.checkedFingerprint(context.destinationUrl),
    ]);
    return {
      sourceUrlHash,
      topUrlHash,
      destinationUrlHash,
      sourceOrigin: getExactHttpOrigin(context.sourceUrl),
      topOrigin: getExactHttpOrigin(context.topUrl),
      destinationOrigin: getExactHttpOrigin(context.destinationUrl),
    };
  }

  private nextOpaqueValue(used: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < MAX_OPAQUE_GENERATION_ATTEMPTS; attempt++) {
      const value = this.generateOpaqueValue();
      if (isOpaquePendingDecisionValue(value) && !used.has(value)) return value;
    }
    throw new Error("Unable to generate a unique pending-decision opaque value");
  }

  private async replaceTabWithRollback(
    tabId: number,
    replacement: readonly PendingDecision[],
  ): Promise<void> {
    const before = cloneRecordMap(this.recordsByTab);
    if (replacement.length === 0) this.recordsByTab.delete(tabId);
    else this.recordsByTab.set(tabId, sortRecords(replacement));
    try {
      await this.persist();
    } catch (error) {
      this.recordsByTab = before;
      throw error;
    }
  }

  private async removeRecordWithRollback(tabId: number, index: number): Promise<void> {
    const records = this.recordsByTab.get(tabId) ?? [];
    const replacement = records.filter((_, recordIndex) => recordIndex !== index);
    await this.replaceTabWithRollback(tabId, replacement);
  }

  private serialize(): StoredPendingDecisions {
    const byTab: Record<string, PendingDecision[]> = {};
    for (const [tabId, records] of [...this.recordsByTab].sort(([left], [right]) => left - right)) {
      byTab[String(tabId)] = sortRecords(records).map(clonePendingDecision);
    }
    return { version: STORAGE_VERSION, byTab };
  }

  private persist(): Promise<void> {
    return this.storage.set({ [PENDING_DECISION_STORAGE_KEY]: this.serialize() });
  }
}
