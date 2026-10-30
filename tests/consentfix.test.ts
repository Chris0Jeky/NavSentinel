import { describe, expect, it } from "vitest";
import { isLoopbackAuthCodePaste } from "../extension/src/content/consentfix";

// ConsentFix: a loopback redirect URL carrying an OAuth code, pasted into a non-loopback page.
describe("isLoopbackAuthCodePaste", () => {
  const code = "http://localhost:8400/?code=0.AXoA_example&state=abc&session_state=xyz";

  it("flags a loopback OAuth redirect pasted into a remote page", () => {
    expect(isLoopbackAuthCodePaste(code, "secure-docs.example")).toBe(true);
    expect(isLoopbackAuthCodePaste(`  ${code}\n`, "secure-docs.example")).toBe(true);
    expect(isLoopbackAuthCodePaste("http://127.0.0.1:53211/callback?state=a&code=xyz", "lure.example")).toBe(true);
    expect(isLoopbackAuthCodePaste("http://[::1]:9000/#access_token=abc", "lure.example")).toBe(true);
    expect(isLoopbackAuthCodePaste("HTTPS://LOCALHOST/?id_token=abc", "lure.example")).toBe(true);
  });

  it("leaves ordinary pastes and loopback pages alone", () => {
    expect(isLoopbackAuthCodePaste(code, "localhost")).toBe(false);
    expect(isLoopbackAuthCodePaste(code, "127.0.0.1")).toBe(false);
    expect(isLoopbackAuthCodePaste("http://localhost:3000/dashboard", "github.com")).toBe(false);
    expect(isLoopbackAuthCodePaste("https://login.microsoftonline.com/common/oauth2/authorize?code=1", "lure.example")).toBe(false);
    expect(isLoopbackAuthCodePaste("see http://localhost:8400/?code=abc in the log", "stackoverflow.com")).toBe(false);
    expect(isLoopbackAuthCodePaste("http://localhost.evil.example/?code=abc", "lure.example")).toBe(false);
    expect(isLoopbackAuthCodePaste("http://localhost:8400/?postcode=SW1A", "lure.example")).toBe(false);
  });
});
