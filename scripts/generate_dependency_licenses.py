#!/usr/bin/env python3
"""Generate deterministic Cargo and npm dependency licence inventory."""

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
            "ecosystem": "cargo",
            "name": package["name"],
            "version": package["version"],
            "license": package.get("license"),
            "source": package.get("source"),
        }
        for package in metadata["packages"]
        if package.get("source") is not None
    ]
    package_lock_path = ROOT / "package-lock.json"
    if package_lock_path.is_file():
        package_lock = json.loads(package_lock_path.read_text(encoding="utf-8"))
        packages.extend(
            {
                "ecosystem": "npm",
                "name": package_path.rsplit("node_modules/", 1)[-1],
                "version": package["version"],
                "license": package.get("license"),
                "source": package.get("resolved"),
            }
            for package_path, package in package_lock.get("packages", {}).items()
            if package_path and "node_modules/" in package_path and not package.get("link")
        )
    packages.sort(
        key=lambda package: (package["ecosystem"], package["name"], package["version"])
    )
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
