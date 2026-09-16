from pathlib import Path
p = Path('tests/extension-build-provenance.test.ts')
text = p.read_text(encoding='utf-8')
old = '''    expectIntegrityCode(
      () => assertCurrentHeadBuildInputs(repository.root, head),
      "MISSING_BLOB_AUTHORITY",
    );'''
new = '''    expectIntegrityCode(
      () => assertCurrentHeadBuildInputs(repository.root, head),
      "MISSING_OBJECT_AUTHORITY",
    );'''
if text.count(old) != 1:
    raise SystemExit(f'missing-object expectation: expected one match, found {text.count(old)}')
text = text.replace(old, new, 1)
old = '    fs.writeFileSync(objectPath, deflateSync(loosePayload));'
new = '    fs.chmodSync(objectPath, 0o600);\n    fs.writeFileSync(objectPath, deflateSync(loosePayload));'
if text.count(old) != 1:
    raise SystemExit(f'loose-object chmod: expected one match, found {text.count(old)}')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
print('Issue #684 unit fixture corrections applied.')
