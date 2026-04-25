import type { CredMode, EventLogEntry } from "../shared/storage";
import type { Mode } from "../shared/types";
import { classifyEventTone } from "../shared/event_tone";
import {
  POPUP_TEST_CRED_MODES,
  POPUP_TEST_NAV_MODES,
  type PopupSnapshot,
  type PopupTestMessage
} from "../shared/popup_test";
import {
  addTrustedDomain,
  appendEvent,
  getEventLog,
  getSuiteSettings,
  getTrustedDomains,
  removeTrustedDomain,
  updateSuiteSettings
} from "../shared/storage";
import {
  derivePopupSiteState,
  getRecentPopupEvents
} from "./popup_model";

const versionEl = document.getElementById("version") as HTMLSpanElement;
const siteEl = document.getElementById("site") as HTMLDivElement;
const trustStatusEl = document.getElementById("trustStatus") as HTMLDivElement;
const trustBtn = document.getElementById("trustBtn") as HTMLButtonElement;
const untrustBtn = document.getElementById("untrustBtn") as HTMLButtonElement;
const navModeEl = document.getElementById("navMode") as HTMLSelectElement;
const credModeEl = document.getElementById("credMode") as HTMLSelectElement;
const eventsEl = document.getElementById("events") as HTMLDivElement;
const refreshBtn = document.getElementById("refreshBtn") as HTMLButtonElement;
const openOptions = document.getElementById("openOptions") as HTMLAnchorElement;

async function getActiveTabUrl(): Promise<string> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url ?? "";
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
}

function formatEventKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function buildEventDetail(event: EventLogEntry): string {
  const parts: string[] = [];
  if (event.site) parts.push(`site ${event.site}`);
  if (event.destHost) parts.push(`dest ${event.destHost}`);
  if (typeof event.score === "number") parts.push(`score ${event.score}`);
  if (event.reasons?.length) {
    parts.push(
      `signals ${event.reasons.slice(0, 3).join(", ")}${event.reasons.length > 3 ? "..." : ""}`
    );
  }
  return parts.join(" • ");
}

function renderEvents(log: EventLogEntry[]): void {
  const list = getRecentPopupEvents(log, 6);
  if (list.length === 0) {
    eventsEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No events yet.";
    eventsEl.appendChild(empty);
    return;
  }

  eventsEl.innerHTML = "";
  for (const event of list) {
    const eventKind = typeof event.kind === "string" ? event.kind : "unknown";
    const card = document.createElement("article");
    card.className = "event-card";
    card.dataset.tone = classifyEventTone(eventKind);

    const head = document.createElement("div");
    head.className = "event-head";

    const kind = document.createElement("div");
    kind.className = "event-kind";
    kind.textContent = formatEventKind(eventKind);

    const time = document.createElement("div");
    time.className = "event-time mono";
    time.textContent = fmtTime(event.ts);

    head.appendChild(kind);
    head.appendChild(time);
    card.appendChild(head);

    const detail = buildEventDetail(event);
    if (detail) {
      const body = document.createElement("div");
      body.className = "event-detail";
      body.textContent = detail;
      card.appendChild(body);
    }

    eventsEl.appendChild(card);
  }
}

async function refreshUi(): Promise<void> {
  const settings = await getSuiteSettings();
  navModeEl.value = settings.nav.defaultMode;
  credModeEl.value = settings.credential.mode;

  const url = await getActiveTabUrl();
  const trusted = await getTrustedDomains();
  const siteState = derivePopupSiteState(url, trusted);
  siteEl.textContent = siteState.siteLabel;
  trustStatusEl.textContent = siteState.trustStatus;
  trustStatusEl.dataset.state = siteState.isTrusted
    ? "trusted"
    : siteState.registrableDomain
      ? "caution"
      : "neutral";
  trustBtn.disabled = !siteState.canTrust;
  untrustBtn.disabled = !siteState.canUntrust;

  renderEvents(await getEventLog());
}

function getPopupSnapshot(): PopupSnapshot {
  const events = Array.from(eventsEl.querySelectorAll(".event-card"))
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean);

  return {
    credMode: credModeEl.value,
    events,
    navMode: navModeEl.value,
    site: siteEl.textContent?.trim() ?? "",
    trustStatus: trustStatusEl.textContent?.trim() ?? ""
  };
}

async function setNavMode(mode: Mode): Promise<void> {
  navModeEl.value = mode;
  await updateSuiteSettings({ nav: { defaultMode: mode } });
  try {
    await appendEvent({ kind: "suite_config_update", extra: { navMode: mode } });
  } catch {
    // ignore
  }
  await refreshUi();
}

async function setCredMode(mode: CredMode): Promise<void> {
  credModeEl.value = mode;
  await updateSuiteSettings({ credential: { mode } });
  try {
    await appendEvent({ kind: "suite_config_update", extra: { credMode: mode } });
  } catch {
    // ignore
  }
  await refreshUi();
}

async function trustCurrentSite(): Promise<void> {
  const url = await getActiveTabUrl();
  const reg = derivePopupSiteState(url, []).registrableDomain;
  if (!reg) return;

  await addTrustedDomain(reg);
  try {
    await appendEvent({ kind: "cred_trust_domain", site: reg });
  } catch {
    // ignore
  }
  await refreshUi();
}

async function untrustCurrentSite(): Promise<void> {
  const url = await getActiveTabUrl();
  const reg = derivePopupSiteState(url, []).registrableDomain;
  if (!reg) return;

  await removeTrustedDomain(reg);
  try {
    await appendEvent({ kind: "cred_untrust_domain", site: reg });
  } catch {
    // ignore
  }
  await refreshUi();
}

navModeEl.addEventListener("change", async () => {
  await setNavMode(navModeEl.value as Mode);
});

credModeEl.addEventListener("change", async () => {
  await setCredMode(credModeEl.value as CredMode);
});

trustBtn.addEventListener("click", async () => {
  await trustCurrentSite();
});

untrustBtn.addEventListener("click", async () => {
  await untrustCurrentSite();
});

refreshBtn.addEventListener("click", async () => {
  await refreshUi();
});

openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function isTrustedPopupTestSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) {
    return false;
  }

  if (sender.tab) {
    return false;
  }

  const extensionBaseUrl = chrome.runtime.getURL("");
  if (typeof sender.url === "string") {
    return sender.url.startsWith(extensionBaseUrl);
  }

  if (typeof sender.origin === "string") {
    return sender.origin === new URL(extensionBaseUrl).origin;
  }

  return true;
}

function parsePopupModeValue(
  value: unknown,
  validValues: readonly string[],
  label: string
): Mode | CredMode {
  if (typeof value !== "string" || !validValues.includes(value)) {
    throw new Error(`Invalid ${label} value: ${String(value)}`);
  }

  return value as Mode | CredMode;
}

chrome.runtime.onMessage.addListener((message: PopupTestMessage, sender, sendResponse) => {
  if (!message || message.type !== "ns_popup_test" || !isTrustedPopupTestSender(sender)) {
    return undefined;
  }

  void (async () => {
    try {
      if (message.action === "snapshot") {
        await refreshUi();
        sendResponse({ ok: true, snapshot: getPopupSnapshot() });
        return;
      }

      if (message.action === "click") {
        switch (message.target) {
          case "trustBtn":
            await trustCurrentSite();
            break;
          case "untrustBtn":
            await untrustCurrentSite();
            break;
          case "refreshBtn":
            await refreshUi();
            break;
          case "openOptions":
            chrome.runtime.openOptionsPage();
            break;
          default:
            throw new Error("Unknown popup target");
        }
        sendResponse({ ok: true, snapshot: getPopupSnapshot() });
        return;
      }

      if (message.action === "select") {
        switch (message.target) {
          case "navMode":
            await setNavMode(parsePopupModeValue(message.value, POPUP_TEST_NAV_MODES, "navMode") as Mode);
            break;
          case "credMode":
            await setCredMode(
              parsePopupModeValue(message.value, POPUP_TEST_CRED_MODES, "credMode") as CredMode
            );
            break;
          default:
            throw new Error("Unknown popup select target");
        }
        sendResponse({ ok: true, snapshot: getPopupSnapshot() });
        return;
      }

      throw new Error("Unsupported popup test action");
    } catch (error) {
      sendResponse({
        error: error instanceof Error ? error.message : String(error),
        ok: false
      });
    }
  })();

  return true;
});

versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
void refreshUi();
