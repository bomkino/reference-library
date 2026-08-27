#!/usr/bin/env python3
"""Verify repository boundaries and pinned toolchain consistency."""

from pathlib import Path
import json
import sys
import tomllib


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    ".github/workflows/ci.yml",
    ".node-version",
    "rust-toolchain.toml",
    "package.json",
    "package-lock.json",
    "Cargo.toml",
    "Cargo.lock",
    "README.md",
    "AGENTS.md",
    "CONTEXT.md",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY.md",
    "DEPENDENCY-LICENSES.json",
    "THIRD_PARTY-NOTICES.txt",
    "assets/branding/reference-library-icon.svg",
    "assets/branding/reference-library-icon-1024.png",
    "apps/macos/ReferenceLibrary.entitlements",
    "apps/macos/ReferenceCore.entitlements",
    "docs/maintenance/REPOSITORY_MAINTENANCE.md",
    "docs/product/PRODUCT_CONSTITUTION.md",
    "docs/specs/TRACER_T01.md",
    "docs/security/SECURITY_MODEL.md",
    "docs/evidence/DECISION_EVIDENCE_LOG.md",
)
FORBIDDEN_DIRS = ("06_EXECUTABLE_PROOF_PROGRAMME", "asset-browser")
EXPECTED_NODE_MAJOR = "24"


def main() -> int:
    problems: list[str] = []
    problems.extend(
        f"missing required file: {path}"
        for path in REQUIRED
        if not (ROOT / path).is_file()
    )
    problems.extend(
        f"forbidden imported corpus: {path}"
        for path in FORBIDDEN_DIRS
        if (ROOT / path).exists()
    )

    try:
        dependency_licences = json.loads(
            (ROOT / "DEPENDENCY-LICENSES.json").read_text()
        )
        if dependency_licences.get("schemaVersion") != 2:
            problems.append(
                "DEPENDENCY-LICENSES.json has unsupported schemaVersion"
            )
    except (OSError, json.JSONDecodeError) as error:
        problems.append(f"cannot read DEPENDENCY-LICENSES.json: {error}")

    try:
        cargo = tomllib.loads((ROOT / "Cargo.toml").read_text())
        rust_version = cargo["workspace"]["package"]["rust-version"]
        expected_rust_channel = f"{rust_version}.0"
        toolchain = tomllib.loads(
            (ROOT / "rust-toolchain.toml").read_text()
        )["toolchain"]
        if toolchain.get("channel") != expected_rust_channel:
            problems.append(
                "rust-toolchain.toml channel must match Cargo.toml rust-version"
            )
        components = set(toolchain.get("components", []))
        if not {"clippy", "rustfmt"}.issubset(components):
            problems.append(
                "rust-toolchain.toml must install clippy and rustfmt"
            )
    except (OSError, KeyError, TypeError, tomllib.TOMLDecodeError) as error:
        problems.append(f"cannot verify Rust toolchain metadata: {error}")
        expected_rust_channel = None

    try:
        node_major = (ROOT / ".node-version").read_text().strip()
        if node_major != EXPECTED_NODE_MAJOR:
            problems.append(
                f".node-version must be {EXPECTED_NODE_MAJOR}, found {node_major!r}"
            )
    except OSError as error:
        problems.append(f"cannot read .node-version: {error}")

    try:
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        if workflow.count('node-version-file: ".node-version"') != 3:
            problems.append(
                "CI must use .node-version in all three Node jobs"
            )
        rust_actions = workflow.count("uses: dtolnay/rust-toolchain@")
        if expected_rust_channel and workflow.count(
            f'toolchain: "{expected_rust_channel}"'
        ) != rust_actions:
            problems.append(
                "every CI Rust action must use the pinned workspace toolchain"
            )
        if workflow.count("timeout-minutes:") != 5:
            problems.append("every CI job must have a timeout")
        if "cancel-in-progress:" not in workflow:
            problems.append("CI must define concurrency cancellation")
    except OSError as error:
        problems.append(f"cannot read CI workflow: {error}")

    if problems:
        for problem in problems:
            print(problem, file=sys.stderr)
        return 1

    print(
        f"repository boundary OK: {len(REQUIRED)} required files; "
        "toolchains pinned; no forbidden corpus"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
