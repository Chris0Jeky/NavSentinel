#!/usr/bin/env python3
"""Apply the two lint findings discovered by issue #684 qualification."""

from pathlib import Path

HELPER_PATH = Path("tests/e2e/extension_build_provenance.ts")

text = HELPER_PATH.read_text(encoding="utf-8")

old_control_check = '''  if (/[\\u0000-\\u001f\\u007f]/u.test(relativePath)) {
    throw integrityError("NON_CANONICAL_PATH", `control character in repository path '${relativePath}'`);
  }'''
new_control_check = '''  const hasControlCharacter = [...relativePath].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
  });
  if (hasControlCharacter) {
    throw integrityError("NON_CANONICAL_PATH", `control character in repository path '${relativePath}'`);
  }'''

if text.count(old_control_check) != 1:
    raise SystemExit("control-character lint fix did not find exactly one source block")
text = text.replace(old_control_check, new_control_check, 1)

unused_path = "  const absolutePath = path.join(authority.root, ...entry.path.split(\"/\"));\n"
if text.count(unused_path) != 1:
    raise SystemExit("unused absolutePath lint fix did not find exactly one declaration")
text = text.replace(unused_path, "", 1)

HELPER_PATH.write_text(text, encoding="utf-8")
print("Issue #684 lint findings patched.")
