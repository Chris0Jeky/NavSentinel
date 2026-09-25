// @vitest-environment happy-dom
/**
 * The held blank-target navigation journals the reason codes behind the
 * decision (#867), so the Protection Center can explain the row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavOutcomeFeatures } from "../extension/src/shared/storage";

const mocks = vi.hoisted(() => ({
  appendEvent: vi.fn((_entry: Record<string, unknown>) => Promise.resolve()),
  appendPromptOutcome: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
}));
vi.mock("../extension/src/shared/storage", () => ({ appendEvent: mocks.appendEvent, appendPromptOutcome: mocks.appendPromptOutcome }));
vi.mock("../extension/src/content/ui_toast", () => ({ showToast: mocks.showToast }));

function stubRuntime(): void {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension-id",
      lastError: undefined,
      getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
      // No service-worker answer: the navigation stays blocked.
      sendMessage: (_message: unknown, callback: (response: unknown) => void) => callback(undefined),
      onMessage: { addListener: () => {} },
    },
  });
}

async function hold(outcomeFeatures: NavOutcomeFeatures): Promise<Record<string, unknown>> {
  const { default: showPendingBlankNavigationPrompt } = await import("../extension/src/content/pending_navigation_decision");
  await showPendingBlankNavigationPrompt({
    title: "Blocked new tab",
    url: "https://destination.test/private?token=secret",
    host: "destination.test",
    promptScore: 82,
    outcomeFeatures,
  });
  const journaled = mocks.appendEvent.mock.calls.map(([entry]) => entry)
    .filter((entry) => entry.kind === "nav_blank_prompt");
  expect(journaled).toHaveLength(1);
  return journaled[0]!;
}

describe("held blank-target navigation journal entry (#867)", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.appendEvent.mockClear();
    stubRuntime();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("records the CDS/NRS codes that held the navigation, and nothing else from the decision", async () => {
    const entry = await hold({
      reasons: ["near_invisible_opacity", "nrs_new_tab_window", "nrs_cross_site"],
      nrsFactors: ["nrs_new_tab_window", "nrs_cross_site"],
      cds: 55,
      thresholdUsed: 70,
    });
    expect(entry).toEqual({
      kind: "nav_blank_prompt",
      site: location.hostname.toLowerCase(),
      destHost: "destination.test",
      reasons: ["near_invisible_opacity", "nrs_new_tab_window", "nrs_cross_site"],
    });
  });

  it("stays reasonless when the decision carried no codes", async () => {
    const entry = await hold({ thresholdUsed: 70 });
    expect(entry).not.toHaveProperty("reasons");
  });
});
