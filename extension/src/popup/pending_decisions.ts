import {
  isOpaquePendingDecisionValue,
} from "../shared/pending_decision";

interface PopupNavigationDecision {
  id: string;
  deliveryToken: string;
  sourceOrigin: string;
  destinationOrigin: string;
  expiresAt: number;
}

export interface PendingDecisionsPopupDependencies {
  sendMessage: (message: unknown) => Promise<unknown>;
  now: () => number;
  setInterval: (callback: () => void, delayMs: number) => number;
  clearInterval: (timer: number) => void;
}

function defaultDependencies(): PendingDecisionsPopupDependencies {
  return {
    sendMessage: (message) => chrome.runtime.sendMessage(message),
    now: Date.now,
    setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
    clearInterval: (timer) => window.clearInterval(timer),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === value;
  } catch {
    return false;
  }
}

function parseNavigationDecision(value: unknown, now: number): PopupNavigationDecision | null {
  if (
    !isRecord(value) ||
    ["sourceUrl", "topUrl", "destinationUrl"].some((field) => field in value) ||
    value.kind !== "navigation" ||
    value.reason !== "blank-target-blocked" ||
    !Array.isArray(value.actions) ||
    value.actions.length !== 1 ||
    value.actions[0] !== "proceed-once" ||
    !isOpaquePendingDecisionValue(value.id) ||
    !isOpaquePendingDecisionValue(value.deliveryToken) ||
    !isHttpOrigin(value.sourceOrigin) ||
    !isHttpOrigin(value.destinationOrigin) ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= now
  ) {
    return null;
  }
  return {
    id: value.id,
    deliveryToken: value.deliveryToken,
    sourceOrigin: value.sourceOrigin,
    destinationOrigin: value.destinationOrigin,
    expiresAt: value.expiresAt as number,
  };
}

function parseListedDecisions(value: unknown, now: number): PopupNavigationDecision[] | null {
  if (
    !isRecord(value) ||
    value.ok !== true ||
    value.operation !== "list" ||
    (value.status !== "missing" && value.status !== "pending") ||
    !Array.isArray(value.decisions)
  ) {
    return null;
  }
  return value.decisions
    .map((decision) => parseNavigationDecision(decision, now))
    .filter((decision): decision is PopupNavigationDecision => decision !== null);
}

export class PendingDecisionsPopupController {
  private readonly dependencies: PendingDecisionsPopupDependencies;
  private decisions: PopupNavigationDecision[] = [];
  private timer = 0;
  private status = "";

  constructor(
    private readonly host: HTMLElement,
    dependencies: PendingDecisionsPopupDependencies = defaultDependencies(),
  ) {
    this.dependencies = dependencies;
  }

  async refresh(): Promise<void> {
    let response: unknown;
    try {
      response = await this.dependencies.sendMessage({ type: "ns-pending-decision-list" });
    } catch {
      this.showFailure("Decision controls are unavailable. Navigation remains blocked.");
      return;
    }
    const listed = parseListedDecisions(response, this.dependencies.now());
    if (!listed) {
      this.showFailure("Decision controls are unavailable. Navigation remains blocked.");
      return;
    }
    this.status = "";
    this.decisions = listed;
    this.render();
    this.updateTimer();
  }

  dispose(): void {
    if (this.timer) this.dependencies.clearInterval(this.timer);
    this.timer = 0;
  }

  private render(): void {
    this.host.replaceChildren();
    const now = this.dependencies.now();
    this.decisions = this.decisions.filter((decision) => decision.expiresAt > now);
    if (this.decisions.length === 0 && this.timer) {
      this.dependencies.clearInterval(this.timer);
      this.timer = 0;
    }
    if (this.decisions.length === 0 && !this.status) {
      this.host.hidden = true;
      return;
    }
    this.host.hidden = false;

    const heading = document.createElement("h2");
    heading.className = "pending-title ns-uc";
    heading.textContent = "Navigation held";
    this.host.appendChild(heading);

    if (this.status) {
      const status = document.createElement("div");
      status.className = "pending-status";
      status.setAttribute("role", "status");
      status.textContent = this.status;
      this.host.appendChild(status);
    }

    for (const decision of this.decisions) {
      const card = document.createElement("div");
      card.className = "pending-card";

      const route = document.createElement("div");
      route.className = "pending-route ns-mono";
      route.textContent = `${decision.sourceOrigin} → ${decision.destinationOrigin}`;
      card.appendChild(route);

      const remaining = document.createElement("div");
      remaining.className = "pending-remaining";
      remaining.textContent = `${Math.max(1, Math.ceil((decision.expiresAt - now) / 1000))}s remaining`;
      card.appendChild(remaining);

      const button = document.createElement("button");
      button.className = "pending-proceed";
      button.type = "button";
      button.textContent = "Proceed once";
      button.addEventListener("click", () => {
        button.disabled = true;
        void this.consume(decision);
      });
      card.appendChild(button);
      this.host.appendChild(card);
    }
  }

  private async consume(decision: PopupNavigationDecision): Promise<void> {
    let response: unknown;
    try {
      response = await this.dependencies.sendMessage({
        type: "ns-pending-decision-consume",
        id: decision.id,
        deliveryToken: decision.deliveryToken,
        action: "proceed-once",
      });
    } catch {
      response = undefined;
    }

    this.decisions = this.decisions.filter((candidate) => candidate.id !== decision.id);
    if (
      isRecord(response) &&
      response.ok === true &&
      response.operation === "consume" &&
      response.status === "consumed" &&
      response.kind === "navigation" &&
      response.action === "proceed-once"
    ) {
      this.status = "Opened in a new tab.";
    } else {
      this.status = "Could not open it. Navigation remains blocked.";
    }
    this.render();
  }

  private showFailure(message: string): void {
    this.decisions = [];
    this.status = message;
    this.render();
  }

  private updateTimer(): void {
    if (this.timer) this.dependencies.clearInterval(this.timer);
    if (this.decisions.length === 0) {
      this.timer = 0;
      return;
    }
    this.timer = this.dependencies.setInterval(() => this.render(), 1000);
  }
}

export function mountPendingDecisions(): PendingDecisionsPopupController | null {
  const host = document.getElementById("pendingDecisions");
  if (!host) return null;
  const controller = new PendingDecisionsPopupController(host);
  void controller.refresh();
  window.addEventListener("pagehide", () => controller.dispose(), { once: true });
  return controller;
}

if (typeof document !== "undefined") mountPendingDecisions();
