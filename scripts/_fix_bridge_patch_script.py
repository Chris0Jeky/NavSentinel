from pathlib import Path

patch_path = Path("scripts/_apply_bridge_clock_patch.py")
text = patch_path.read_text(encoding="utf-8")
needle = 'dedent("""' + '\\' + '\n      if (data.type === "ns-clipboard-write")'
inner = text.index(needle)
start = text.rfind("replace_once(", 0, inner)
end_marker = (
    'replace_once(\n'
    '    "extension/src/content/capture_isolated.ts",\n'
    '    \'  if (handlePushStateBridgeMessage'
)
end = text.index(end_marker, inner)
replacement = '''replace_once(
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
patch_path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
