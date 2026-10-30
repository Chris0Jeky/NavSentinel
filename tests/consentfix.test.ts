import { describe, expect, it } from "vitest";
import { isAuthCodePaste } from "../extension/src/content/consentfix";

// ConsentFix: a loopback redirect URL carrying an OAuth code, pasted into a non-loopback page.
describe("isAuthCodePaste", () => {
  const code = "http://localhost:8400/?code=0.AXoA_example&state=abc&session_state=xyz";

  it("flags a loopback OAuth redirect pasted into a remote page", () => {
    expect(isAuthCodePaste(code, "secure-docs.example")).toBe(true);
    expect(isAuthCodePaste(`  ${code}\n`, "secure-docs.example")).toBe(true);
    expect(isAuthCodePaste("http://127.0.0.1:53211/callback?state=a&code=xyz", "lure.example")).toBe(true);
    expect(isAuthCodePaste("http://[::1]:9000/#access_token=abc", "lure.example")).toBe(true);
    expect(isAuthCodePaste("HTTPS://LOCALHOST/?id_token=abc", "lure.example")).toBe(true);
  });

  it("flags the code with the address trimmed off", () => {
    const tail = "code=0.AXoAexampleexampleexample-abc&state=xyz&session_state=123";
    expect(isAuthCodePaste(tail, "lure.example")).toBe(true);
    expect(isAuthCodePaste(`?${tail}`, "lure.example")).toBe(true);
    expect(isAuthCodePaste("code=short&state=x", "lure.example")).toBe(false);
    expect(isAuthCodePaste("code=0.AXoAexampleexampleexample-abc", "lure.example")).toBe(false);
    // Any provider's ordinary callback query (no Microsoft session_state) is not flagged.
    expect(isAuthCodePaste("code=gho_exampleexampleexample1234&state=xyz", "github.com")).toBe(false);
  });

  it("leaves ordinary pastes and loopback pages alone", () => {
    expect(isAuthCodePaste(code, "localhost")).toBe(false);
    expect(isAuthCodePaste(code, "127.0.0.1")).toBe(false);
    expect(isAuthCodePaste("http://localhost:3000/dashboard", "github.com")).toBe(false);
    expect(isAuthCodePaste("https://login.microsoftonline.com/common/oauth2/authorize?code=1", "lure.example")).toBe(false);
    expect(isAuthCodePaste("see http://localhost:8400/?code=abc in the log", "stackoverflow.com")).toBe(false);
    expect(isAuthCodePaste("http://localhost.evil.example/?code=abc", "lure.example")).toBe(false);
    expect(isAuthCodePaste("http://localhost:8400/?postcode=SW1A", "lure.example")).toBe(false);
  });

  it("flags Microsoft first-party redirect URLs with a code (Volexity UTA0352/UTA0355)", () => {
    const vscode = "https://insiders.vscode.dev/redirect?code=1.AXoAexample&state=mae.gov.ro";
    const azure = "https://vscode-redirect.azurewebsites.net/?code=0.AXoAexample&state=x";
    const join = "https://login.microsoftonline.com/WebApp/CloudDomainJoin/8?code=0.AXoAexample&session_state=y";
    const native = "https://login.microsoftonline.com/common/oauth2/nativeclient?code=0.AXoAexample";
    for (const url of [vscode, azure, join, native]) {
      expect(isAuthCodePaste(url, "web.whatsapp.com"), url).toBe(true);
      expect(isAuthCodePaste(url, "mail.google.com"), url).toBe(true);
    }
    // Pasting on the redirect page's own host is not the theft.
    expect(isAuthCodePaste(vscode, "insiders.vscode.dev")).toBe(false);
    expect(isAuthCodePaste(join, "login.microsoftonline.com")).toBe(false);
  });

  it("leaves first-party pages without a code alone", () => {
    expect(isAuthCodePaste("https://insiders.vscode.dev/redirect", "web.whatsapp.com")).toBe(false);
    expect(isAuthCodePaste("https://login.microsoftonline.com/common/oauth2/authorize?client_id=x", "mail.google.com")).toBe(false);
    expect(isAuthCodePaste("https://insiders.vscode.dev/docs?postcode=1", "mail.google.com")).toBe(false);
    expect(isAuthCodePaste("https://login.microsoftonline.com.evil.example/WebApp/CloudDomainJoin/8?code=1", "mail.google.com")).toBe(false);
  });

  it("flags a bare Entra code, the stable vscode.dev redirect and a scheme-less first-party URL", () => {
    const code = `1.AXoA${"Ab3_-".repeat(30)}`;
    expect(isAuthCodePaste(code, "web.whatsapp.com")).toBe(true);
    expect(isAuthCodePaste(`code=${code}&state=mae.gov.ro`, "mail.google.com")).toBe(true);
    expect(isAuthCodePaste("https://vscode.dev/redirect?code=1.AXoAexample", "web.whatsapp.com")).toBe(true);
    expect(isAuthCodePaste("insiders.vscode.dev/redirect?code=1.AXoAexample", "web.whatsapp.com")).toBe(true);
    expect(isAuthCodePaste("vscode.dev/redirect?code=1.AXoAexample", "vscode.dev")).toBe(false);
  });

  it("leaves short, prose-wrapped and version-like strings alone", () => {
    expect(isAuthCodePaste("1.AXoA_short", "mail.google.com")).toBe(false);
    expect(isAuthCodePaste(`my code is 1.AXoA${"Ab3_-".repeat(30)} thanks`, "mail.google.com")).toBe(false);
    expect(isAuthCodePaste("1.A section heading", "mail.google.com")).toBe(false);
    expect(isAuthCodePaste(`eyJ${"a".repeat(200)}`, "mail.google.com")).toBe(false);
  });
});
