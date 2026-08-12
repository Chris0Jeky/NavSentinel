export const POPUP_TEST_NAV_MODES = ["off", "smart", "strict"] as const;
export const POPUP_TEST_CRED_MODES = ["off", "smart", "strict"] as const;
export const POPUP_TEST_CLICK_TARGETS = [
  "trustBtn",
  "untrustBtn",
  "refreshBtn",
  "openOptions"
] as const;
export const POPUP_TEST_SELECT_TARGETS = ["navMode", "credMode"] as const;

export type PopupTestClickTarget = (typeof POPUP_TEST_CLICK_TARGETS)[number];
export type PopupTestSelectTarget = (typeof POPUP_TEST_SELECT_TARGETS)[number];

export type PopupTestMessage =
  | { type: "ns_popup_test"; action: "snapshot" }
  | { type: "ns_popup_test"; action: "click"; target: PopupTestClickTarget }
  | { type: "ns_popup_test"; action: "select"; target: PopupTestSelectTarget; value: string };

export type PopupSnapshot = {
  credMode: string;
  events: string[];
  eventIcons: string[];
  navMode: string;
  signalChipClasses: string[];
  site: string;
  tabRisk: number | null;
  trustStatus: string;
};

export type PopupTestResponse = {
  error?: string;
  ok: boolean;
  snapshot?: PopupSnapshot;
};
