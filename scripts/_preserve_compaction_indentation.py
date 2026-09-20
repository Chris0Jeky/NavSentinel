from pathlib import Path

path = Path("scripts/_compact_retained_recovery.py")
text = path.read_text(encoding="utf-8")
old = "from textwrap import dedent\n"
new = '''from textwrap import dedent as _stdlib_dedent

# Patch anchors are copied with their repository indentation. Keep that
# indentation rather than normalizing it away before exact matching.
def dedent(value: str) -> str:
    return value
'''
if text.count(old) != 1:
    raise RuntimeError("compaction dedent import changed unexpectedly")
path.write_text(text.replace(old, new), encoding="utf-8")
