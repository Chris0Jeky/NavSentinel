import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createService } = require("../experiments/vision-lab/daemon/server.cjs");
const scenarios = require("../experiments/vision-lab/shared/scenarios.js");

let service;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-shell-paste-receipt-"));
  service = await createService({ port: 0, labPort: 0, dataDir: dir, quiet: true });
});

after(async () => {
  await service?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

for (const signals of [undefined, []]) test(`shell-paste attempt (${signals ? "no signals" : "fixture signals"}) still blocks with 422 and leaves a journal receipt`, async () => {
  const shellScenario = scenarios.find((s) => s.id === "shell");
  assert.ok(shellScenario, "shell fixture scenario exists");
  const event = structuredClone(shellScenario.event);
  if (signals) event.signals = signals;

  const beforeResponse = await fetch(`${service.origin}/api/state`, {
    headers: { Authorization: `Bearer ${service.adminToken}` },
  });
  assert.equal(beforeResponse.status, 200);
  const beforeState = await beforeResponse.json();

  const response = await fetch(`${service.origin}/api/request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${service.agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event }),
  });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.decision, "block");

  const stateResponse = await fetch(`${service.origin}/api/state`, {
    headers: { Authorization: `Bearer ${service.adminToken}` },
  });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.journal.entries.length, beforeState.journal.entries.length + 1);
  const receipt = state.journal.entries.at(-1).data;
  assert.equal(receipt.action, "shell-paste");
  assert.equal(receipt.kind, "decision");
  assert.equal(receipt.decision, "block");
  assert.equal(receipt.wouldDecide, "block");
  assert.equal(receipt.evidence, "declared");
  assert.equal(receipt.sourceKind, "broker");
  assert.equal(state.pending.length, 0);
  assert.equal(state.capabilities, 0);
});
