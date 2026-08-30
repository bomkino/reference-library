#!/usr/bin/env python3
"""Generate the deterministic legal inventory shipped by both applications.

The inventory is deliberately narrower than a development dependency dump:
Cargo packages must be reachable without a dev edge for one of the two shipped
targets, and npm packages must be in the application production closure or the
Electron runtime/bootstrap closure used to construct the Linux application.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = ROOT / "DEPENDENCY-LICENSES.json"
NOTICES_PATH = ROOT / "THIRD_PARTY-NOTICES.txt"
CARGO_TARGETS = {
    "linux-x86_64": "x86_64-unknown-linux-gnu",
    "macos-arm64": "aarch64-apple-darwin",
}


def cargo_metadata(target: str) -> dict[str, Any]:
    process = subprocess.run(
        [
            "cargo",
            "metadata",
            "--locked",
            "--format-version",
            "1",
            "--filter-platform",
            target,
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(process.stdout)


def cargo_production_packages(metadata: dict[str, Any]) -> dict[str, dict[str, Any]]:
    packages = {package["id"]: package for package in metadata["packages"]}
    nodes = {node["id"]: node for node in metadata["resolve"]["nodes"]}
    pending = list(metadata["workspace_members"])
    reachable: set[str] = set()
    while pending:
        package_id = pending.pop()
        if package_id in reachable:
            continue
        reachable.add(package_id)
        for dependency in nodes[package_id].get("deps", []):
            kinds = dependency.get("dep_kinds") or [{"kind": None}]
            if any(kind.get("kind") != "dev" for kind in kinds):
                pending.append(dependency["pkg"])
    return {
        package_id: packages[package_id]
        for package_id in reachable
        if packages[package_id].get("source") is not None
    }


def resolve_lock_dependency(
    packages: dict[str, dict[str, Any]], package_path: str, dependency: str
) -> str:
    current = package_path
    while True:
        prefix = current.rsplit("/node_modules/", 1)[0] if "/node_modules/" in current else ""
        candidate = f"{prefix + '/' if prefix else ''}node_modules/{dependency}"
        if candidate in packages:
            return candidate
        if not prefix:
            break
        current = prefix
    raise ValueError(f"package-lock cannot resolve {dependency!r} from {package_path or '<root>'}")


def npm_closure(packages: dict[str, dict[str, Any]], seeds: Iterable[str]) -> set[str]:
    pending = list(seeds)
    reachable: set[str] = set()
    while pending:
        package_path = pending.pop()
        if package_path in reachable:
            continue
        package = packages.get(package_path)
        if package is None:
            raise ValueError(f"package-lock is missing closure seed {package_path}")
        reachable.add(package_path)
        dependencies = {
            **package.get("dependencies", {}),
            **package.get("optionalDependencies", {}),
        }
        pending.extend(
            resolve_lock_dependency(packages, package_path, dependency)
            for dependency in dependencies
        )
    return reachable


def npm_production_groups(lock: dict[str, Any]) -> dict[str, set[str]]:
    packages = lock.get("packages", {})
    workspace_paths = [
        package["resolved"]
        for package in packages.values()
        if package.get("link") and package.get("resolved") in packages
    ]
    application = npm_closure(packages, ["", *workspace_paths])
    electron_path = "node_modules/electron"
    if electron_path not in packages:
        raise ValueError("package-lock is missing the pinned Electron runtime")
    electron = npm_closure(packages, [electron_path])
    return {"npm-production": application, "electron-runtime": electron}


def build_inventory() -> dict[str, Any]:
    records: dict[tuple[str, str, str], dict[str, Any]] = {}
    cargo_counts: dict[str, int] = {}
    for target_name, cargo_target in CARGO_TARGETS.items():
        packages = cargo_production_packages(cargo_metadata(cargo_target))
        cargo_counts[target_name] = len(packages)
        for package in packages.values():
            key = ("cargo", package["name"], package["version"])
            record = records.setdefault(
                key,
                {
                    "ecosystem": "cargo",
                    "name": package["name"],
                    "version": package["version"],
                    "license": package.get("license"),
                    "source": package.get("source"),
                    "shippedIn": [],
                },
            )
            record["shippedIn"].append(target_name)

    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    packages = lock.get("packages", {})
    npm_counts: dict[str, int] = {}
    for group, package_paths in npm_production_groups(lock).items():
        external_paths = {
            package_path
            for package_path in package_paths
            if package_path
            and "node_modules/" in package_path
            and not packages[package_path].get("link")
        }
        npm_counts[group] = len(external_paths)
        for package_path in external_paths:
            package = packages[package_path]
            name = package_path.rsplit("node_modules/", 1)[-1]
            key = ("npm", name, package["version"])
            record = records.setdefault(
                key,
                {
                    "ecosystem": "npm",
                    "name": name,
                    "version": package["version"],
                    "license": package.get("license"),
                    "source": package.get("resolved"),
                    "shippedIn": [],
                },
            )
            record["shippedIn"].append(group)

    package_records = sorted(
        records.values(), key=lambda item: (item["ecosystem"], item["name"], item["version"])
    )
    for record in package_records:
        record["shippedIn"].sort()
        if not record["license"]:
            raise ValueError(
                f"locked shipped dependency has no declared license: "
                f"{record['ecosystem']}:{record['name']}@{record['version']}"
            )
    return {
        "schemaVersion": 2,
        "generated": True,
        "generator": "scripts/generate_dependency_licenses.py",
        "scope": {
            "cargo": {
                "edgePolicy": "workspace production and build edges; dev edges excluded",
                "targets": CARGO_TARGETS,
                "packageCounts": cargo_counts,
            },
            "npm": {
                "edgePolicy": "application production closure plus pinned Electron runtime closure",
                "packageCounts": npm_counts,
            },
        },
        "packages": package_records,
    }


def build_notices(inventory: dict[str, Any]) -> str:
    lines = [
        "Reference Library — Shipped Third-Party Dependency Notices",
        "==========================================================",
        "",
        "Generated from Cargo.lock and package-lock.json. Development-only",
        "dependencies are excluded except Electron's pinned runtime/bootstrap",
        "closure, whose binary and Chromium notices are also retained by the",
        "Linux package contract.",
        "",
    ]
    for package in inventory["packages"]:
        lines.extend(
            [
                f"{package['ecosystem']}:{package['name']}@{package['version']}",
                f"License: {package['license']}",
                f"Shipped in: {', '.join(package['shippedIn'])}",
                f"Source: {package['source']}",
                "",
            ]
        )
    lines.extend(
        [
            "Electron packages must additionally contain LICENSE.electron.txt and",
            "LICENSES.chromium.html from the exact packaged Electron distribution.",
            "The Reference Library application license and notices are in LICENSE",
            "and NOTICE beside this inventory in the packaged Legal directory.",
            "",
        ]
    )
    return "\n".join(lines)


def rendered_outputs() -> dict[Path, str]:
    inventory = build_inventory()
    return {
        INVENTORY_PATH: json.dumps(inventory, indent=2) + "\n",
        NOTICES_PATH: build_notices(inventory),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if committed legal outputs differ from exact locked production graphs",
    )
    args = parser.parse_args()
    outputs = rendered_outputs()
    if args.check:
        stale = [
            path.name
            for path, content in outputs.items()
            if not path.is_file() or path.read_text(encoding="utf-8") != content
        ]
        if stale:
            print(f"stale dependency legal outputs: {', '.join(stale)}", file=sys.stderr)
            return 1
        print(
            "dependency legal bundle OK: "
            f"{len(json.loads(outputs[INVENTORY_PATH])['packages'])} locked shipped packages"
        )
        return 0
    for path, content in outputs.items():
        path.write_text(content, encoding="utf-8")
        print(f"wrote {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
