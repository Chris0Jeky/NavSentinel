from pathlib import Path

path = Path("scripts/_compact_retained_recovery.py")
text = path.read_text(encoding="utf-8")
old = '''replace_once(
    unit,
    '    expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("false");\\n',
    '    expect(getRecoveryCard()?.classList.contains("recovery-docked")).toBe(false);\\n',
)
replace_once(
    unit,
    '    expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("false");\\n',
    '    expect(getRecoveryCard()?.classList.contains("recovery-docked")).toBe(false);\\n',
)
'''
new = '''unit_path = Path(unit)
unit_text = unit_path.read_text(encoding="utf-8")
old_pre_dock = '    expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("false");\\n'
new_pre_dock = '    expect(getRecoveryCard()?.classList.contains("recovery-docked")).toBe(false);\\n'
if unit_text.count(old_pre_dock) != 2:
    raise RuntimeError("pre-dock assertion count changed unexpectedly")
unit_path.write_text(unit_text.replace(old_pre_dock, new_pre_dock), encoding="utf-8")
'''
if text.count(old) != 1:
    raise RuntimeError("duplicate assertion patch block changed unexpectedly")
path.write_text(text.replace(old, new), encoding="utf-8")
