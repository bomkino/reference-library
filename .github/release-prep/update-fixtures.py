from pathlib import Path

VERSION = "0.2.0"

expected = {
    "scripts/tests/linux-artifact-contract.test.mjs": 3,
    "scripts/tests/macos-artifact-contract.test.mjs": 1,
    "scripts/tests/release-metadata.test.mjs": 2,
}

for path, expected_count in expected.items():
    file = Path(path)
    source = file.read_text()
    observed = source.count("0.1.0")
    if observed != expected_count:
        raise SystemExit(
            f"{path}: expected {expected_count} reviewed 0.1.0 fixtures, found {observed}"
        )
    file.write_text(source.replace("0.1.0", VERSION))
