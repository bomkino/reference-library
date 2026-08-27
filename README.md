# Reference Library

[![CI](https://github.com/bomkino/reference-library/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bomkino/reference-library/actions/workflows/ci.yml)

Reference Library is a project-specific, local-first visual research and source-organising application for pitch-deck work. It has no account, telemetry, cloud dependency or embedded AI.

One project gets one `.pitchlibrary` package. Apple-Silicon macOS is primary. Garuda Linux / Arch / KDE is the binding Linux target. Both editions share canonical document meaning.

## Status

V1 is **source-ready and canonical on `main`**. The five-job CI workflow verifies repository boundaries, Rust protocol/Core behavior, shared workspace and Linux source, extracted Linux packages under X11 and headless Wayland, and the ad-hoc-signed Apple-Silicon app ZIP.

Source-ready is not target-integrated. Representative Apple Silicon and Jenai's Garuda system still need the M1, L1, X1 and C1 journeys. No tag or public GitHub release exists.

Exact historical evidence lives in the [V1 main-integration receipt](docs/evidence/V1_MAIN_INTEGRATION_RECEIPT.md) and [V1 source-ready receipt](docs/evidence/V1_SOURCE_READY_RECEIPT.md). The latest successful `main` workflow is the current source evidence; CI artifacts are not releases.

## V1 scope

- project-local `.pitchlibrary` package
- authorized Root add, reconnect and rescan
- stable Asset identity across supported external renames
- bounded still-image thumbnails and previews
- manual review, title and note curation
- lexical query, filters, sorting and flat Collections
- native reveal and opaque resource delivery
- bounded cross-host canonical proof

Excerpts, similarity, duplicate review, source mutation, broad professional formats, nested or smart Collections, tags, ratings, saved searches, MCP and automatic updates remain deferred.

## Repository map

- `crates/`: shared Rust protocol and Core
- `packages/`: shared bridge contract and editorial workspace
- `apps/`: native platform shells
- `migrations/`: canonical SQLite migrations
- `scripts/`: verification, packaging and evidence tools
- `docs/`: product, architecture, security, maintenance and receipts
- `fixtures/`: tiny committed fixtures; large fixtures are generated

Read `AGENTS.md`, `CONTEXT.md` and `docs/specs/V1_EXECUTION_CONTRACT.md` before changing source.

## Toolchains

- Node.js 24 from `.node-version`
- Rust 1.90.0, Clippy and rustfmt from `rust-toolchain.toml`
- Python 3.11 or newer for repository and licence checks
- Swift toolchain supplied by the supported macOS/Xcode host

## Verify a source checkout

```bash
npm ci --ignore-scripts
python3 scripts/check_repository.py
node scripts/generate-product-icon.mjs --check
node scripts/check-release-metadata.mjs
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --locked -p reference-core
npm audit --audit-level=high
npm run check
node scripts/t01-semantic-roundtrip.mjs --core target/debug/reference-core
node scripts/v1-semantic-roundtrip.mjs --core target/debug/reference-core
python3 scripts/generate_dependency_licenses.py --check
node scripts/legal-bundle-contract.mjs --directory .
```

`cargo audit` is also mandatory in CI through pinned `cargo-audit` 0.22.2. macOS source verification adds `swift test --package-path apps/macos`.

See [repository maintenance](docs/maintenance/REPOSITORY_MAINTENANCE.md) for package gates, evidence rules and branch cleanup.

## Licence

GNU Affero General Public License v3.0. See `LICENSE`.
