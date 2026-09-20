from pathlib import Path

path = Path("scripts/_apply_shadow_guard_arrival.py")
text = path.read_text(encoding="utf-8")
replacements = {
    "      kind?: string;\n": "      kind: string | undefined;\n",
    "      messageTarget?: string;\n": "      messageTarget: string | undefined;\n",
    "      promptTarget?: string;\n": "      promptTarget: string | undefined;\n",
}
for old, new in replacements.items():
    if text.count(old) != 1:
        raise RuntimeError(f"shadow input anchor changed: {old.strip()}")
    text = text.replace(old, new)
path.write_text(text, encoding="utf-8")
