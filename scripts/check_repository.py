#!/usr/bin/env python3
"""Small repository-boundary check; production seam tests live with their owners."""

from pathlib import Path
import json
import sys


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    "AGENTS.md",
    "CONTEXT.md",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY.md",
    "DEPENDENCY-LICENSES.json",
    "THIRD_PARTY-NOTICES.txt",
    "docs/product/PRODUCT_CONSTITUTION.md",
    "docs/specs/TRACER_T01.md",
    "docs/security/SECURITY_MODEL.md",
    "docs/evidence/DECISION_EVIDENCE_LOG.md",
)
FORBIDDEN_DIRS = ("06_EXECUTABLE_PROOF_PROGRAMME", "asset-browser")


def main() -> int:
    missing = [path for path in REQUIRED if not (ROOT / path).is_file()]
    forbidden = [path for path in FORBIDDEN_DIRS if (ROOT / path).exists()]
    dependency_licences = json.loads((ROOT / "DEPENDENCY-LICENSES.json").read_text())
    if dependency_licences.get("schemaVersion") != 2:
        print("DEPENDENCY-LICENSES.json has unsupported schemaVersion", file=sys.stderr)
        return 1
    if missing or forbidden:
        for path in missing:
            print(f"missing required file: {path}", file=sys.stderr)
        for path in forbidden:
            print(f"forbidden imported corpus: {path}", file=sys.stderr)
        return 1
    print(f"repository boundary OK: {len(REQUIRED)} required files; no forbidden corpus")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
