#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
for relative in [
    'docs/evidence/BRUTALIST_UI_REVIEW.md',
    'docs/evidence/BRUTALIST_UI_ACCESSIBILITY.md',
    'docs/evidence/BRUTALIST_UI_IMPLEMENTATION_RECEIPT.md',
    'docs/evidence/BRUTALIST_UI_MOTION_POLICY.md',
    'docs/evidence/BRUTALIST_UI_SCOPE.md',
    'docs/evidence/BRUTALIST_UI_FINAL_CHECKLIST.md',
    'docs/evidence/BRUTALIST_UI_NOTE.md',
    'docs/evidence/BRUTALIST_UI_STOP.md',
    'docs/evidence/BRUTALIST_UI_PROMOTION.md',
    'docs/evidence/BRUTALIST_UI_LAST.md',
    'docs/evidence/BRUTALIST_UI_END.md',
    'docs/evidence/BRUTALIST_UI_LOCK.md',
    '.github/brutalist-ui-repair.py',
    '.github/brutalist-ui-clean.py',
]:
    target = root / relative
    if target.exists():
        target.unlink()
print('post-build cleanup applied')
