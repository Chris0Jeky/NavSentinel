import { describe, expect, it } from "vitest";
// @ts-expect-error The offline Observatory is a Node JavaScript module without declarations.
import { parseSource, sha256 } from "../experiments/evidence-observatory/model.mjs";

type Receipt = Record<string, unknown>;

function overlayWithReceipt(receipt: Receipt): string {
  const raw: any = {
    schema_version: "1.0.0",
    scenario_id: "NS-ADV-UI-004",
    fixture: { role: "attack", sha256: "c".repeat(64) },
    repository_head: "a".repeat(40),
    extension_build_sha256: "b".repeat(64),
    browser: { version: "143.0.7499.4" },
    profile: "proving_ground",
    outcome: "BLOCKED_PRE_HARM",
    valid: true,
    network_violations: [],
    blocked_external_attempts: [],
    oracle: {
      type: "independent_harm",
      sink_receipt_count: 1,
      observation: {
        baselineReceiptCount: 0,
        protectedReceiptCount: 1,
        trustedUnderlyingClicksCompleted: 1,
      },
      sink_snapshot: { receipts: [receipt], invalidAttempts: [] },
    },
  };
  raw.oracle.local_receipt_sha256 = sha256(
    JSON.stringify({ sinkSnapshot: raw.oracle.sink_snapshot, observation: raw.oracle.observation }),
  );
  return JSON.stringify(raw);
}

const validReceipt = (): Receipt => ({
  sequence: 1,
  runId: "r1",
  scenarioId: "NS-ADV-UI-004",
  role: "attack",
  consequence: "wrong-target-navigation",
  targetId: "unit-attack-harm",
  method: "GET",
  sentinelSha256: "d".repeat(64),
});

describe("observatory sink receipt promotion", () => {
  it("keeps a well-formed consequence/targetId pair", () => {
    const parsed = parseSource(overlayWithReceipt(validReceipt()));
    expect(parsed.cases).toHaveLength(1);
    const row = (parsed.cases[0] as any).events.find((e: any) => e.kind === "sink.snapshot.row");
    expect(row.data.consequence).toBe("wrong-target-navigation");
    expect(row.data.targetId).toBe("unit-attack-harm");
  });

  it("rejects the reported malformed consequence/targetId pair", () => {
    const receipt = { ...validReceipt(), consequence: "bad value!!!", targetId: "also bad!!!" };
    expect(() => parseSource(overlayWithReceipt(receipt))).toThrow("SINK_RECEIPT_INVALID");
  });

  it("rejects a malformed consequence even with a valid targetId", () => {
    const receipt = { ...validReceipt(), consequence: "bad value!!!" };
    expect(() => parseSource(overlayWithReceipt(receipt))).toThrow("SINK_RECEIPT_INVALID");
  });

  it("rejects a malformed targetId even with a valid consequence", () => {
    const receipt = { ...validReceipt(), targetId: "also bad!!!" };
    expect(() => parseSource(overlayWithReceipt(receipt))).toThrow("SINK_RECEIPT_INVALID");
  });

  // Legacy decision: null/missing consequence/targetId are NOT legitimate legacy
  // inputs. Pre-fix sinkRows coerced invalid tokens to null and kept the row,
  // which is the bug above. Existing fixtures that omit these fields
  // (experiments/evidence-observatory/tests/model.test.mjs overlay() omits
  // targetId; hidden() omits both) and the fake-sink producer spread
  // `...(targetId ? { targetId } : {})` never waived offline promotion: the
  // recorder binding requires an armed targetId, so a targetless or
  // consequenceless row is a proven invalid receipt and must throw rather than
  // be widened into a null-bearing row.
  it.each([
    ["missing consequence", { ...validReceipt(), consequence: undefined }],
    ["null consequence", { ...validReceipt(), consequence: null }],
    ["missing targetId", { ...validReceipt(), targetId: undefined }],
    ["null targetId", { ...validReceipt(), targetId: null }],
  ])("legacy case: %s is an invalid receipt, not a null-bearing row", (_name, receipt) => {
    // JSON drops undefined keys, matching fixtures that omit the field.
    expect(() => parseSource(overlayWithReceipt(receipt as Receipt))).toThrow("SINK_RECEIPT_INVALID");
  });
});
