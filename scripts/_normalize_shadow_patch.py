from pathlib import Path

path = Path("scripts/_apply_shadow_guard_arrival.py")
text = path.read_text(encoding="utf-8")
old = '''def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement anchor, found {count}")
    target.write_text(text.replace(old, new), encoding="utf-8")
'''
new = '''def replace_once(path: str, old: str, new: str) -> None:
    import re

    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count == 1:
        target.write_text(text.replace(old, new), encoding="utf-8")
        return
    if count > 1:
        raise RuntimeError(f"{path}: expected one replacement anchor, found {count}")

    lines = old.splitlines(keepends=True)
    first = next((index for index, line in enumerate(lines) if line.strip()), None)
    if first is None:
        raise RuntimeError(f"{path}: empty replacement anchor")

    pieces: list[str] = []
    for index, line in enumerate(lines):
        has_newline = line.endswith("\\n")
        content = line[:-1] if has_newline else line
        suffix = "\\n" if has_newline else ""
        if not content.strip():
            pieces.append(r"[ \\t]*" + suffix)
            continue
        if index == first:
            pieces.append(r"(?P<indent>[ \\t]*)" + re.escape(content.lstrip(" \\t")) + suffix)
        else:
            pieces.append(r"(?P=indent)" + re.escape(content) + suffix)

    matches = list(re.finditer("".join(pieces), text, re.MULTILINE))
    if len(matches) != 1:
        raise RuntimeError(
            f"{path}: expected one indentation-aware replacement anchor, found {len(matches)}"
        )

    match = matches[0]
    indent = match.group("indent")
    replacement = "".join(
        line if not line.rstrip("\\r\\n").strip() else indent + line
        for line in new.splitlines(keepends=True)
    )
    target.write_text(text[:match.start()] + replacement + text[match.end():], encoding="utf-8")
'''
if text.count(old) != 1:
    raise RuntimeError("shadow patch helper definition changed unexpectedly")
path.write_text(text.replace(old, new), encoding="utf-8")
