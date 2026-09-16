#!/usr/bin/env python3
"""Apply strict-TypeScript findings discovered by issue #684 qualification."""

from pathlib import Path

HELPER_PATH = Path("tests/e2e/extension_build_provenance.ts")
text = HELPER_PATH.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    "  error?: Error;\n",
    "  error: Error | undefined;\n",
    "exact optional GitResult error",
)

replace_once(
    '''    const [, mode, type, oid] = match;
    const relativePath = decodeUtf8Path(record.subarray(tab + 1));''',
    '''    const mode = match[1];
    const type = match[2];
    const oid = match[3];
    if (mode === undefined || type === undefined || oid === undefined) {
      throw integrityError("MALFORMED_GIT_OUTPUT", `incomplete git ls-tree header '${header}'`);
    }
    const relativePath = decodeUtf8Path(record.subarray(tab + 1));''',
    "ls-tree capture narrowing",
)

replace_once(
    '''    const [, mode, oid, stage] = match;
    const relativePath = decodeUtf8Path(record.subarray(tab + 1));''',
    '''    const mode = match[1];
    const oid = match[2];
    const stage = match[3];
    if (mode === undefined || oid === undefined || stage === undefined) {
      throw integrityError("MALFORMED_GIT_OUTPUT", `incomplete git index header '${header}'`);
    }
    const relativePath = decodeUtf8Path(record.subarray(tab + 1));''',
    "index capture narrowing",
)

replace_once(
    '''  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);''',
    '''  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);''',
    "tracked path segment narrowing",
)

HELPER_PATH.write_text(text, encoding="utf-8")
print("Issue #684 strict-TypeScript findings patched.")
