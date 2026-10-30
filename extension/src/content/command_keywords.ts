/**
 * Shell/command keyword matching shared by both content-script worlds. (#810)
 *
 * The main-world guard (main_guard.ts) classifies clipboard writes with this
 * pattern and sends only the boolean to the isolated world; the isolated-world
 * detector used to carry its own copy (plus a third copy in the property
 * test), pinned by nothing but "keep in sync" comments. This module is
 * deliberately side-effect-free — no DOM, no storage, no state — so both
 * worlds and the tests import the SAME values. (Same pattern as
 * main_guard_constants.ts.)
 *
 * One regex rather than a keyword array: it ships in the MAIN-world bundle,
 * whose perf budget has almost no headroom, and a regex is shorter than the
 * quoted list plus its loop (#1166).
 */

/**
 * Shell/command keywords that suggest malicious clipboard content, matched
 * case-insensitively as substrings: Windows shells and LOLBins, Unix/macOS
 * shells, PowerShell cmdlets and encodings, `finger user@host`, WebDAV UNC
 * paths (`\\host@SSL\...`) and IP-literal UNC paths, all used by 2025
 * ClickFix payloads.
 */
export const COMMAND_PATTERN =
  /powershell|pwsh|cmd\s*\/|cmd\.exe|%comspec%|conhost|mshta|msiexec|certutil|bitsadmin|rundll32|regsvr32|wscript|cscript|forfiles|pcalua|schtasks|installutil|wmic|msbuild|cmstp|curl[ .]|wget[ .]|bash|\bsh |\/bin\/|osascript|invoke-|iex[ (]|iwr |start-process|download(string|file)|new-object|system\.net|frombase64|base64|-enc(odedcommand| )|finger \S+@|@(ssl|\d+)\\|\\\\[\d.]+\\/i;

/**
 * True when the text contains a shell/command keyword (min length 5).
 * cmd ignores `^` and `"` inside a word and PowerShell ignores backticks, so
 * those are stripped first: `p^ow"er"shell` still runs, so it still matches.
 */
export function looksLikeCommand(text: string): boolean {
  return text.length >= 5 && COMMAND_PATTERN.test(text.replace(/[\^`"]/g, ""));
}
