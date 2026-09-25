/**
 * Shell/command keyword matching shared by both content-script worlds. (#810)
 *
 * The main-world guard (main_guard.ts) classifies clipboard writes with this
 * list and sends only the boolean to the isolated world; the isolated-world
 * detector used to carry its own copy (plus a third copy in the property
 * test), pinned by nothing but "keep in sync" comments. This module is
 * deliberately side-effect-free — no DOM, no storage, no state — so both
 * worlds and the tests import the SAME values. (Same pattern as
 * main_guard_constants.ts.)
 */

/**
 * Shell/command keywords that suggest malicious clipboard content.
 * Checked against written text; matching is case-insensitive substring.
 */
export const COMMAND_KEYWORDS: readonly string[] = [
  // Windows shells and scripting
  "powershell",
  "cmd /",
  "cmd.exe",
  "mshta",
  "msiexec",
  "certutil",
  "bitsadmin",
  "rundll32",
  "regsvr32",
  "wscript",
  "cscript",
  // Windows LOLBins
  "forfiles",
  "pcalua",
  "schtasks",
  "installutil",
  // Unix/macOS shells
  "curl ",
  "wget ",
  "bash",
  "sh ",
  "/bin/",
  "osascript",
  // PowerShell cmdlets and patterns
  "invoke-",
  "iex ",
  "iex(",
  "iwr ",
  "start-process",
  "downloadstring",
  "downloadfile",
  "new-object",
  "system.net",
  "frombase64",
  "base64",
  "-encodedcommand",
  "-enc ",
];

/** True when the text contains a shell/command keyword (min length 5). */
export function looksLikeCommand(text: string): boolean {
  if (!text || text.length < 5) return false;
  const lower = text.toLowerCase();
  for (const kw of COMMAND_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}
