// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { showToast } from "../extension/src/content/ui_toast";
import { _resetDeviceCodeLure, checkDeviceCodeLure as check } from "../extension/src/content/devicecode_lure";
import { scannableText } from "../extension/src/content/clickfix_detector";

const checkDeviceCodeLure = (host: string) => check(scannableText, host, false);

vi.mock("../extension/src/content/ui_toast", () => ({ showToast: vi.fn() }));

// #1223: the lure page that hands out a device code is where the warning belongs.
describe("checkDeviceCodeLure", () => {
  beforeEach(() => {
    _resetDeviceCodeLure();
    vi.mocked(showToast).mockClear();
  });

  it.each([
    "Join the meeting: go to microsoft.com/devicelogin and enter code ABCD1234E",
    "Open https://aka.ms/devicelogin and paste your code",
    "Visit www.google.com/device and enter XQR-TFD-MNB",
    "Authorize at https://github.com/login/device with code 1A2B-3C4D",
  ])("warns once on a lure page: %s", (text) => {
    document.body.innerHTML = `<p>${text}</p>`;
    checkDeviceCodeLure("secure-meeting.example");
    checkDeviceCodeLure("secure-meeting.example");
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showToast).mock.calls[0]![0]).toMatchObject({ timeoutMs: 0 });
    expect(vi.mocked(showToast).mock.calls[0]![0].persistent).toBeUndefined();
  });

  it("stays quiet on docs and in-browser terminals, and on pages without a device address", () => {
    document.body.innerHTML = "<p>To sign in, open https://microsoft.com/devicelogin and enter the code ABCD1234E.</p>";
    for (const host of ["learn.microsoft.com", "shell.azure.com", "fluffy-space-x.github.dev", "colab.research.google.com"]) {
      checkDeviceCodeLure(host);
    }
    document.body.innerHTML = "<p>Manage devices at google.com/devices</p><p>Your order code is ABCD1234.</p>";
    checkDeviceCodeLure("shop.example");
    expect(showToast).not.toHaveBeenCalled();
  });

  it("reads the address inside an open shadow root", () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).innerHTML = "<p>Go to microsoft.com/devicelogin</p>";
    document.body.append(host);
    checkDeviceCodeLure("teams-invite.example");
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["split across elements", "<p>Open <b>microsoft.com</b>/<i>devicelogin</i></p>"],
    ["broken by wbr", "<p>Open microsoft.com/device<wbr>login</p>"],
    ["zero-width space", "<p>Open microsoft.com/device​login</p>"],
    ["spaced out", "<p>Open microsoft . com / devicelogin</p>"],
    ["full-width", "<p>Open ｍｉｃｒｏｓｏｆｔ.com/devicelogin</p>"],
  ])("still matches an address %s", (_name, html) => {
    document.body.innerHTML = html;
    checkDeviceCodeLure("lure.example");
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("does not exempt Codespaces port hosts (anyone can serve pages there)", () => {
    document.body.innerHTML = "<p>Go to microsoft.com/devicelogin</p>";
    checkDeviceCodeLure("my-space-8080.app.github.dev");
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("looks once more 1.5 s later for an address shown after the copy", () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = "<p>Copied!</p>";
      check(scannableText, "lure.example");
      expect(showToast).not.toHaveBeenCalled();
      document.body.innerHTML = "<p>Now open microsoft.com/devicelogin</p>";
      vi.advanceTimersByTime(1500);
      expect(showToast).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000);
      expect(showToast).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
