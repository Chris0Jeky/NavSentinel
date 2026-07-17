import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PENDING_DECISION_MAX_PER_TAB,
  PENDING_DECISION_TTL_MS,
  type PendingCredentialDecisionSemantics,
  type PendingDecision,
  type PendingDecisionSemantics,
  type PendingDecisionVerifiedContext,
  type PendingNavigationDecisionSemantics,
} from "../extension/src/shared/pending_decision";
import {
  PENDING_DECISION_STORAGE_KEY,
  PendingDecisionStore,
  didConsumePendingDecision,
  hasPendingDecisions,
  type PendingDecisionCreateStatus,
  type PendingDecisionSessionStorage,
} from "../extension/src/sw/pending_decision_store";

const fingerprintUrl = async (url: string): Promise<string> =>
  createHash("sha256").update(url).digest("hex");

function createOpaqueGenerator(): () => string {
  let value = 1;
  return () => (value++).toString(16).padStart(32, "0");
}

function verifiedContext(
  overrides: Partial<PendingDecisionVerifiedContext> = {},
): PendingDecisionVerifiedContext {
  return {
    tabId: 7,
    windowId: 2,
    frameId: 0,
    documentId: "document-7-top",
    sourceUrl: "https://source.test/private/source?session=source-secret#source-fragment",
    topUrl: "https://source.test/private/top?token=top-secret#top-fragment",
    ...overrides,
  };
}

function navigationSemantics(
  overrides: Partial<PendingNavigationDecisionSemantics> = {},
): PendingNavigationDecisionSemantics {
  return {
    kind: "navigation",
    reason: "navigation-blocked",
    destinationUrl: "https://destination.test/private/path?token=destination-secret#dest-fragment",
    actions: ["proceed-once", "allow-route"],
    ...overrides,
  };
}

function credentialSemantics(
  overrides: Partial<PendingCredentialDecisionSemantics> = {},
): PendingCredentialDecisionSemantics {
  return {
    kind: "credential",
    reason: "credential-submit-blocked",
    destinationUrl: "https://identity.test/private/session?token=credential-secret",
    actions: ["proceed-once", "trust-source", "trust-destination"],
    ...overrides,
  };
}

interface StorageMock extends PendingDecisionSessionStorage {
  readonly data: Record<string, unknown>;
  readonly setCalls: Record<string, unknown>[];
  failNextGet: boolean;
  failNextSet: boolean;
  maxConcurrentSets: number;
  setGate: Promise<void> | null;
}

function createStorage(seed: Record<string, unknown> = {}): StorageMock {
  const data = structuredClone(seed);
  const setCalls: Record<string, unknown>[] = [];
  let activeSets = 0;
  return {
    data,
    setCalls,
    failNextGet: false,
    failNextSet: false,
    maxConcurrentSets: 0,
    setGate: null,
    async get(key: string) {
      if (this.failNextGet) {
        this.failNextGet = false;
        throw new Error("session read failed");
      }
      return { [key]: structuredClone(data[key]) };
    },
    async set(items: Record<string, unknown>) {
      activeSets++;
      this.maxConcurrentSets = Math.max(this.maxConcurrentSets, activeSets);
      try {
        if (this.setGate) await this.setGate;
        if (this.failNextSet) {
          this.failNextSet = false;
          throw new Error("session write failed");
        }
        const cloned = structuredClone(items);
        setCalls.push(cloned);
        Object.assign(data, cloned);
      } finally {
        activeSets--;
      }
    },
  };
}

function storedByTab(storage: StorageMock): Record<string, PendingDecision[]> {
  const payload = storage.data[PENDING_DECISION_STORAGE_KEY] as {
    version: number;
    byTab: Record<string, PendingDecision[]>;
  };
  return payload.byTab;
}

function makeStore(storage: StorageMock, now: () => number): PendingDecisionStore {
  return new PendingDecisionStore({
    storage,
    now,
    generateOpaqueValue: createOpaqueGenerator(),
    fingerprintUrl,
  });
}

async function requireCreated(
  resultPromise: Promise<PendingDecisionCreateStatus>,
): Promise<Extract<PendingDecisionCreateStatus, { status: "created" }>> {
  const result = await resultPromise;
  expect(result.status).toBe("created");
  if (result.status !== "created") throw new Error("Expected decision creation");
  return result;
}

describe("PendingDecisionStore", () => {
  it("persists only URL hashes and origins, then round-trips bounded display metadata", async () => {
    const storage = createStorage();
    const context = verifiedContext();
    const semantics = {
      ...navigationSemantics({
        reason: "allow-route-suggestion",
        actions: ["allow-route"],
        score: 82,
        signals: ["cross_site", "NRS-high"],
      }),
      untrustedDisplayHtml: "<b>drop me</b>",
    } as PendingDecisionSemantics;
    const created = await requireCreated(makeStore(storage, () => 10_000).create(context, semantics));

    expect(created.decision).toMatchObject({
      sourceOrigin: "https://source.test",
      topOrigin: "https://source.test",
      destinationOrigin: "https://destination.test",
      sourceUrlHash: await fingerprintUrl(context.sourceUrl),
      topUrlHash: await fingerprintUrl(context.topUrl),
      destinationUrlHash: await fingerprintUrl(semantics.destinationUrl),
      score: 82,
      signals: ["cross_site", "NRS-high"],
      createdAt: 10_000,
      expiresAt: 10_000 + PENDING_DECISION_TTL_MS,
    });

    const serialized = JSON.stringify(storage.data[PENDING_DECISION_STORAGE_KEY]);
    for (const sensitive of [
      context.sourceUrl,
      context.topUrl,
      semantics.destinationUrl,
      "/private/",
      "source-secret",
      "top-secret",
      "destination-secret",
      "source-fragment",
      "top-fragment",
      "dest-fragment",
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
    expect(serialized).not.toContain("untrustedDisplayHtml");

    const hydrated = makeStore(storage, () => 11_000);
    const listed = await hydrated.listForVerifiedTab({
      tabId: context.tabId,
      windowId: context.windowId,
      topUrl: context.topUrl,
    });
    expect(hasPendingDecisions(listed)).toBe(true);
    if (listed.status === "pending") {
      expect(listed.decisions[0]?.score).toBe(82);
      expect(listed.decisions[0]?.signals).toEqual(["cross_site", "NRS-high"]);
    }
  });

  it("rejects identity smuggling, invalid metadata, and cross-kind actions", async () => {
    const storage = createStorage();
    const store = makeStore(storage, () => 1_000);
    const invalid: PendingDecisionSemantics[] = [
      { ...navigationSemantics(), tabId: 99 } as unknown as PendingDecisionSemantics,
      { ...navigationSemantics(), sourceUrl: "https://forged.test/" } as unknown as PendingDecisionSemantics,
      navigationSemantics({ score: -1 }),
      navigationSemantics({ score: 101 }),
      navigationSemantics({ score: 1.5 }),
      navigationSemantics({ signals: Array.from({ length: 9 }, (_, index) => `signal_${index}`) }),
      navigationSemantics({ signals: ["a".repeat(65)] }),
      navigationSemantics({ signals: ["duplicate", "duplicate"] }),
      navigationSemantics({ signals: ["contains whitespace"] }),
      { ...navigationSemantics(), actions: ["trust-source"] } as unknown as PendingDecisionSemantics,
      { ...credentialSemantics(), actions: ["allow-route"] } as unknown as PendingDecisionSemantics,
      navigationSemantics({ reason: "navigation-rollback", actions: ["allow-route"] }),
      navigationSemantics({ reason: "navigation-forward-offer", actions: ["allow-route"] }),
      navigationSemantics({ reason: "allow-route-suggestion", actions: ["proceed-once"] }),
      credentialSemantics({ reason: "credential-paste-risk", actions: ["proceed-once"] }),
      credentialSemantics({ reason: "credential-paste-risk", actions: ["trust-destination"] }),
    ];

    for (const semantics of invalid) {
      await expect(store.create(verifiedContext(), semantics)).rejects.toThrow(
        "Invalid pending-decision semantics",
      );
    }

    const validCredential = await requireCreated(
      store.create(verifiedContext({ frameId: 1, documentId: "credential-frame" }), credentialSemantics()),
    );
    expect(validCredential.decision.actions).toEqual([
      "proceed-once",
      "trust-source",
      "trust-destination",
    ]);
    const validPaste = await requireCreated(
      store.create(
        verifiedContext({ frameId: 2, documentId: "paste-frame" }),
        credentialSemantics({ reason: "credential-paste-risk", actions: ["trust-source"] }),
      ),
    );
    expect(validPaste.decision.actions).toEqual(["trust-source"]);
  });

  it("requires exact hashed context, keeps destination binding worker-owned, and consumes once", async () => {
    const storage = createStorage();
    const context = verifiedContext();
    const semantics = navigationSemantics({ actions: ["proceed-once"] });
    const store = makeStore(storage, () => 9_000);
    const created = await requireCreated(store.create(context, semantics));
    const authorization = {
      id: created.decision.id,
      deliveryToken: created.decision.deliveryToken,
      action: "proceed-once" as const,
    };

    expect(
      (
        await store.consume({ ...context, sourceUrl: `${context.sourceUrl}&changed=1` }, authorization)
      ).status,
    ).toBe("mismatch");
    expect(
      (await store.consume(context, { ...authorization, action: "allow-route" })).status,
    ).toBe("action-not-allowed");

    storage.failNextSet = true;
    await expect(
      store.consume(context, authorization),
    ).rejects.toThrow("session write failed");
    expect(
      (
        await store.listForVerifiedTab({
          tabId: context.tabId,
          windowId: context.windowId,
          topUrl: context.topUrl,
        })
      ).status,
    ).toBe("pending");

    const consumed = await store.consume(context, authorization);
    expect(didConsumePendingDecision(consumed)).toBe(true);
    if (consumed.status === "consumed") {
      expect(consumed.decision.destinationUrlHash).toBe(created.decision.destinationUrlHash);
      expect(consumed.decision.destinationOrigin).toBe(created.decision.destinationOrigin);
    }
    expect(
      (await store.consume(context, authorization)).status,
    ).toBe("missing");
  });

  it("coexists across frames and kinds while replacing only the exact scope", async () => {
    const storage = createStorage();
    let now = 20_000;
    const store = makeStore(storage, () => now++);
    const top = verifiedContext();
    const child = verifiedContext({ frameId: 1, documentId: "document-child-1" });
    const topNav = await requireCreated(store.create(top, navigationSemantics()));
    const childNav = await requireCreated(store.create(child, navigationSemantics()));
    const childCredential = await requireCreated(store.create(child, credentialSemantics()));

    const replacement = await requireCreated(
      store.create(
        child,
        navigationSemantics({ destinationUrl: "https://replacement.test/exact?value=2" }),
      ),
    );
    expect(replacement.replacedDecisionId).toBe(childNav.decision.id);

    const listed = await store.listForVerifiedTab({ tabId: 7, windowId: 2, topUrl: top.topUrl });
    expect(listed.status).toBe("pending");
    if (listed.status === "pending") {
      expect(listed.decisions).toHaveLength(3);
      const ids = listed.decisions.map((decision) => decision.id);
      expect(ids).toContain(topNav.decision.id);
      expect(ids).toContain(childCredential.decision.id);
      expect(ids).toContain(replacement.decision.id);
      expect(ids).not.toContain(childNav.decision.id);
    }
  });

  it("rejects child overflow without evicting an existing top-frame decision", async () => {
    const storage = createStorage();
    let now = 30_000;
    const store = makeStore(storage, () => now++);
    const top = verifiedContext();
    const topDecision = await requireCreated(store.create(top, navigationSemantics()));
    for (let frameId = 1; frameId < PENDING_DECISION_MAX_PER_TAB; frameId++) {
      await requireCreated(
        store.create(
          verifiedContext({ frameId, documentId: `child-${frameId}` }),
          navigationSemantics(),
        ),
      );
    }

    const rejected = await store.create(
      verifiedContext({ frameId: 8, documentId: "child-8" }),
      navigationSemantics(),
    );
    expect(rejected.status).toBe("rejected-capacity");
    const listed = await store.listForVerifiedTab({ tabId: 7, windowId: 2, topUrl: top.topUrl });
    expect(listed.status).toBe("pending");
    if (listed.status === "pending") {
      expect(listed.decisions).toHaveLength(PENDING_DECISION_MAX_PER_TAB);
      expect(listed.decisions.map((decision) => decision.id)).toContain(topDecision.decision.id);
    }
  });

  it("admits a top-frame decision at capacity by evicting only the oldest child", async () => {
    const storage = createStorage();
    let now = 40_000;
    const store = makeStore(storage, () => now++);
    const children: PendingDecision[] = [];
    for (let frameId = 1; frameId <= PENDING_DECISION_MAX_PER_TAB; frameId++) {
      const created = await requireCreated(
        store.create(
          verifiedContext({ frameId, documentId: `flood-child-${frameId}` }),
          navigationSemantics(),
        ),
      );
      children.push(created.decision);
    }

    const top = await requireCreated(store.create(verifiedContext(), navigationSemantics()));
    expect(top.evictedDecisionId).toBe(children[0]?.id);
    const listed = await store.listForVerifiedTab({
      tabId: 7,
      windowId: 2,
      topUrl: verifiedContext().topUrl,
    });
    expect(listed.status).toBe("pending");
    if (listed.status === "pending") {
      const ids = listed.decisions.map((decision) => decision.id);
      expect(ids).toHaveLength(PENDING_DECISION_MAX_PER_TAB);
      expect(ids).toContain(top.decision.id);
      expect(ids).not.toContain(children[0]?.id);
    }
  });

  it("does not let stale top-document records strand the current top frame at capacity", async () => {
    const storage = createStorage();
    let now = 45_000;
    const store = makeStore(storage, () => now++);
    const stale: PendingDecision[] = [];
    for (let index = 0; index < PENDING_DECISION_MAX_PER_TAB; index++) {
      stale.push(
        (
          await requireCreated(
            store.create(
              verifiedContext({
                documentId: `stale-top-${index}`,
                sourceUrl: `https://source.test/stale/${index}`,
                topUrl: `https://source.test/stale/${index}`,
              }),
              navigationSemantics(),
            ),
          )
        ).decision,
      );
    }

    const currentContext = verifiedContext({
      documentId: "current-top",
      sourceUrl: "https://source.test/current",
      topUrl: "https://source.test/current",
    });
    const current = await requireCreated(store.create(currentContext, navigationSemantics()));
    expect(current.evictedDecisionId).toBe(stale[0]?.id);
    const listed = await store.listForVerifiedTab({
      tabId: currentContext.tabId,
      windowId: currentContext.windowId,
      topUrl: currentContext.topUrl,
    });
    expect(listed.status).toBe("pending");
    if (listed.status === "pending") {
      expect(listed.decisions.map((decision) => decision.id)).toEqual([current.decision.id]);
    }
  });

  it("lists only for an exact verified tab, window, and top URL", async () => {
    const storage = createStorage();
    const context = verifiedContext();
    const store = makeStore(storage, () => 50_000);
    await store.create(context, navigationSemantics());

    expect(
      (await store.listForVerifiedTab({ tabId: 7, windowId: 3, topUrl: context.topUrl })).status,
    ).toBe("missing");
    expect(
      (
        await store.listForVerifiedTab({
          tabId: 7,
          windowId: 2,
          topUrl: `${context.topUrl}&changed=1`,
        })
      ).status,
    ).toBe("missing");
    expect(
      (await store.listForVerifiedTab({ tabId: 7, windowId: 2, topUrl: context.topUrl })).status,
    ).toBe("pending");
  });

  it("clears a rejected hydration cache so a transient read failure can recover", async () => {
    const storage = createStorage();
    const context = verifiedContext();
    await makeStore(storage, () => 60_000).create(context, navigationSemantics());
    storage.failNextGet = true;
    const restarted = makeStore(storage, () => 61_000);

    await expect(
      restarted.listForVerifiedTab({ tabId: 7, windowId: 2, topUrl: context.topUrl }),
    ).rejects.toThrow("session read failed");
    expect(
      (await restarted.listForVerifiedTab({ tabId: 7, windowId: 2, topUrl: context.topUrl })).status,
    ).toBe("pending");
  });

  it("linearizes same-scope creates by invocation order, not hash completion speed", async () => {
    const storage = createStorage();
    let releaseSlow: (() => void) | undefined;
    let markSlowStarted: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const slowStarted = new Promise<void>((resolve) => {
      markSlowStarted = resolve;
    });
    const store = new PendingDecisionStore({
      storage,
      now: () => 65_000,
      generateOpaqueValue: createOpaqueGenerator(),
      fingerprintUrl: async (url) => {
        if (url.includes("slow-older")) {
          markSlowStarted?.();
          await slowGate;
        }
        return fingerprintUrl(url);
      },
    });
    const context = verifiedContext();
    const olderPromise = store.create(
      context,
      navigationSemantics({ destinationUrl: "https://destination.test/slow-older" }),
    );
    await slowStarted;
    const newerPromise = store.create(
      context,
      navigationSemantics({ destinationUrl: "https://destination.test/newer" }),
    );
    releaseSlow?.();

    const older = await requireCreated(olderPromise);
    const newer = await requireCreated(newerPromise);
    expect(newer.replacedDecisionId).toBe(older.decision.id);
    const listed = await store.listForVerifiedTab({
      tabId: context.tabId,
      windowId: context.windowId,
      topUrl: context.topUrl,
    });
    expect(listed.status).toBe("pending");
    if (listed.status === "pending") {
      expect(listed.decisions.map((decision) => decision.id)).toEqual([newer.decision.id]);
    }
  });

  it("does not resurrect a create that was already hashing when tab cleanup queued", async () => {
    const storage = createStorage();
    let releaseSlow: (() => void) | undefined;
    let markSlowStarted: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const slowStarted = new Promise<void>((resolve) => {
      markSlowStarted = resolve;
    });
    const store = new PendingDecisionStore({
      storage,
      now: () => 67_000,
      generateOpaqueValue: createOpaqueGenerator(),
      fingerprintUrl: async (url) => {
        if (url.includes("slow-before-removal")) {
          markSlowStarted?.();
          await slowGate;
        }
        return fingerprintUrl(url);
      },
    });
    const context = verifiedContext();
    const createPromise = store.create(
      context,
      navigationSemantics({ destinationUrl: "https://destination.test/slow-before-removal" }),
    );
    await slowStarted;
    const removalPromise = store.removeForTabLifecycle(context.tabId);
    releaseSlow?.();

    await requireCreated(createPromise);
    expect(await removalPromise).toEqual({ status: "removed", removedCount: 1 });
    expect(
      (
        await store.listForVerifiedTab({
          tabId: context.tabId,
          windowId: context.windowId,
          topUrl: context.topUrl,
        })
      ).status,
    ).toBe("missing");
    expect(storedByTab(storage)[String(context.tabId)]).toBeUndefined();
  });

  it("rechecks lifecycle validity after hashing and before persistence", async () => {
    const storage = createStorage();
    let releaseHash!: () => void;
    let markHashStarted!: () => void;
    const hashGate = new Promise<void>((resolve) => {
      releaseHash = resolve;
    });
    const hashStarted = new Promise<void>((resolve) => {
      markHashStarted = resolve;
    });
    const store = new PendingDecisionStore({
      storage,
      now: () => 68_000,
      generateOpaqueValue: createOpaqueGenerator(),
      fingerprintUrl: async (url) => {
        if (url.includes("lifecycle-guard")) {
          markHashStarted();
          await hashGate;
        }
        return fingerprintUrl(url);
      },
    });
    let lifecycleCurrent = true;
    const create = store.create(
      verifiedContext({
        sourceUrl: "https://source.test/lifecycle-guard",
        topUrl: "https://source.test/lifecycle-guard",
      }),
      navigationSemantics(),
      () => lifecycleCurrent,
    );
    await hashStarted;
    lifecycleCurrent = false;
    releaseHash();

    expect(await create).toEqual({ status: "context-changed" });
    expect(storage.data[PENDING_DECISION_STORAGE_KEY]).toBeUndefined();
  });

  it("rolls back failed creation and logically expires before physical cleanup", async () => {
    const storage = createStorage();
    let now = 70_000;
    const context = verifiedContext();
    const store = makeStore(storage, () => now);
    const original = await requireCreated(store.create(context, navigationSemantics()));
    storage.failNextSet = true;
    await expect(
      store.create(
        context,
        navigationSemantics({ destinationUrl: "https://replacement.test/private?secret=value" }),
      ),
    ).rejects.toThrow("session write failed");
    const beforeExpiry = await store.listForVerifiedTab({ tabId: 7, windowId: 2, topUrl: context.topUrl });
    expect(beforeExpiry.status).toBe("pending");
    if (beforeExpiry.status === "pending") expect(beforeExpiry.decisions[0]?.id).toBe(original.decision.id);

    now += PENDING_DECISION_TTL_MS;
    expect(storedByTab(storage)["7"]).toHaveLength(1);
    expect(
      (await store.listForVerifiedTab({ tabId: 7, windowId: 2, topUrl: context.topUrl })).status,
    ).toBe("missing");
    expect(storedByTab(storage)["7"]).toBeUndefined();
  });

  it("serializes concurrent writes and awaits explicit lifecycle removal", async () => {
    const storage = createStorage();
    let releaseWrite: (() => void) | undefined;
    storage.setGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const store = makeStore(storage, () => 80_000);
    const first = store.create(verifiedContext(), navigationSemantics());
    const second = store.create(
      verifiedContext({ frameId: 1, documentId: "concurrent-child" }),
      navigationSemantics(),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(storage.maxConcurrentSets).toBe(1);
    releaseWrite?.();
    await Promise.all([first, second]);
    expect(storage.maxConcurrentSets).toBe(1);

    let releaseRemoval: (() => void) | undefined;
    storage.setGate = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    let removalSettled = false;
    const removal = store.removeForTabLifecycle(7).finally(() => {
      removalSettled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(removalSettled).toBe(false);
    releaseRemoval?.();
    const removed = await removal;
    expect(removed).toEqual({ status: "removed", removedCount: 2 });
    expect(storedByTab(storage)["7"]).toBeUndefined();
  });
});
