#!/usr/bin/env python3
"""Generate deterministic Rust dependency licence inventory from Cargo metadata."""

import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    process = subprocess.run(
        ["cargo", "metadata", "--locked", "--format-version", "1"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    metadata = json.loads(process.stdout)
    packages = [
        {
            "name": package["name"],
            "version": package["version"],
            "license": package.get("license"),
            "source": package.get("source"),
        }
        for package in metadata["packages"]
        if package.get("source") is not None
    ]
    packages.sort(key=lambda package: (package["name"], package["version"]))
    inventory = {
        "schemaVersion": 1,
        "generated": True,
        "generator": "scripts/generate_dependency_licenses.py",
        "packages": packages,
    }
    destination = ROOT / "DEPENDENCY-LICENSES.json"
    destination.write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {destination.name}: {len(packages)} packages")


if __name__ == "__main__":
    main()
