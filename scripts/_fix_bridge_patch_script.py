from pathlib import Path

patch_path = Path("scripts/_apply_bridge_clock_patch.py")
text = patch_path.read_text(encoding="utf-8")

# Replace the formatting-sensitive capture_isolated multiline edit with three
# narrow exact replacements. This keeps every source-shape assertion fail-closed.
needle = 'dedent("""' + '\\' + '\n      if (data.type === "ns-clipboard-write")'
inner = text.index(needle)
start = text.rfind("replace_once(", 0, inner)
end_marker = (
    'replace_once(\n'
    '    "extension/src/content/capture_isolated.ts",\n'
    '    \'  if (handlePushStateBridgeMessage'
)
end = text.index(end_marker, inner)
capture_replacement = '''replace_once(
    "extension/src/content/capture_isolated.ts",
    '  if (data.type === "ns-clipboard-write") {\\n',
    '  const receivedAtMs = Date.now();\\n\\n  if (data.type === "ns-clipboard-write") {\\n',
)
replace_once(
    "extension/src/content/capture_isolated.ts",
    '    const ts = typeof data.ts === "number" ? data.ts : Date.now();\\n'
    '    const contentLength = typeof data.contentLength === "number" ? data.contentLength : -1;\\n'
    '    const cmdLike = typeof data.looksLikeCommand === "boolean" ? data.looksLikeCommand : false;\\n'
    '    recordClipboardWrite({ ts, contentLength, looksLikeCommand: cmdLike });\\n',
    '    recordClipboardBridgeWrite({\\n'
    '      ts: data.ts,\\n'
    '      contentLength: data.contentLength,\\n'
    '      looksLikeCommand: data.looksLikeCommand,\\n'
    '    }, receivedAtMs);\\n',
)
replace_once(
    "extension/src/content/capture_isolated.ts",
    '    const dblResult = handleDblclickBridgeMessage(data.type ?? "", data);\\n',
    '    const dblResult = handleDblclickBridgeMessage(data.type ?? "", data, receivedAtMs);\\n',
)
'''
text = text[:start] + capture_replacement + text[end:]

# Preserve the describe-block indentation in the legacy PushState contract.
test_inner = text.index('it("returns false after stale period (>10s)"')
test_start = text.rfind("replace_once(", 0, test_inner)
test_end = text.index('Path("tests/main-world-clock.test.ts").write_text(', test_inner)
test_replacement = '''replace_once(
    "tests/pushstate-guard.test.ts",
    '    it("returns false after stale period (>10s)", () => {\\n'
    '      const oldTs = Date.now() - 11_000;\\n'
    '      handlePushStateBridgeMessage("ns-pushstate-suspicious", {\\n'
    '        ts: oldTs,\\n'
    '        url: "/accounts.chase.com/login",\\n'
    '      });\\n'
    '      expect(isPushStateAbuseActive()).toBe(false);\\n'
    '    });\\n',
    '    it("does not let a stale producer timestamp expire a fresh receipt", () => {\\n'
    '      const oldTs = Date.now() - 11_000;\\n'
    '      handlePushStateBridgeMessage("ns-pushstate-suspicious", {\\n'
    '        ts: oldTs,\\n'
    '        url: "/accounts.chase.com/login",\\n'
    '      });\\n'
    '      expect(isPushStateAbuseActive()).toBe(true);\\n'
    '    });\\n',
)

'''
text = text[:test_start] + test_replacement + text[test_end:]
patch_path.write_text(text, encoding="utf-8")
