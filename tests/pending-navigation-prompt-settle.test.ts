/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { showToastMock, appendEventMock, appendPromptOutcomeMock } = vi.hoisted(
  () => ({
    showToastMock: vi.fn(),
    appendEventMock: vi.fn(async () => {}),
    appendPromptOutcomeMock: vi.fn(async () => {}),
  }),
);

vi.mock("../extension/src/content/ui_toast", () => ({
  showToast: showToastMock,
}));
vi.mock("../extension/src/shared/storage", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../extension/src/shared/storage")>();
  return {
    ...original,
    appendEvent: appendEventMock,
    appendPromptOutcome: appendPromptOutcomeMock,
  };
});

import showPendingBlankNavigationPrompt from "../extension/src/content/pending_navigation_decision";

const DESTINATION_URL = "https://destination.test/private/path";
const DEST_HOST = "destination.test";

function baseRequest() {
  return {
    title: "Blocked new tab",
    url: DESTINATION_URL,
    host: DEST_HOST,
    promptScore: 81,
    outcomeFeatures: { thresholdUsed: 70 },
  };
}

function stubChrome(
  sendMessageImpl: (
    message: unknown,
    callback?: (response: unknown) => void,
  ) => void,
): void {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension-id",
      getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
      sendMessage: sendMessageImpl,
      onMessage: { addListener: vi.fn() },
      lastError: undefined,
    },
  });
}

describe("showPendingBlankNavigationPrompt settles messaging failures (#849)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves false with the remains-blocked toast when sendMessage throws", async () => {
    // Production failure mode: chrome.runtime.sendMessage throws
    // synchronously when the extension context is gone, which rejects the
    // wrapper promise inside defaultDependencies. Pre-fix this promise
    // rejected (and the voided .then branch rejected unhandled with no toast).
    stubChrome(() => {
      throw new Error("Extension context invalidated");
    });

    const result = await showPendingBlankNavigationPrompt(baseRequest());

    expect(result).toBe(false);
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Navigation remains blocked"),
      }),
    );
  });

  it("resolves true with the review toast when the worker creates the decision", async () => {
    stubChrome((_message: unknown, callback?: (response: unknown) => void) => {
      callback?.({
        ok: true,
        operation: "create",
        status: "created",
        id: "a".repeat(32),
        expiresAt: Date.now() + 30_000,
      });
    });

    const result = await showPendingBlankNavigationPrompt(baseRequest());

    expect(result).toBe(true);
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Open NavSentinel to review"),
      }),
    );
  });

  it("resolves false with the remains-blocked toast when the worker is silent", async () => {
    // lastError path: defaultDependencies resolves undefined, create() gets
    // no decision metadata.
    stubChrome((_message: unknown, callback?: (response: unknown) => void) => {
      (
        chrome.runtime as unknown as { lastError: unknown }
      ).lastError = new Error("No receiver");
      callback?.(undefined);
    });

    const result = await showPendingBlankNavigationPrompt(baseRequest());

    expect(result).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Navigation remains blocked"),
      }),
    );
  });
});
