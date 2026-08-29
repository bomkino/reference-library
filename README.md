# Reference Library

[![CI](https://github.com/bomkino/reference-library/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bomkino/reference-library/actions/workflows/ci.yml)

Reference Library is a project-specific, local-first visual research and source-organising application for pitch-deck work. It has no account, telemetry, cloud dependency or embedded AI.

One project gets one `.pitchlibrary` package. Apple-Silicon macOS is primary. Garuda Linux / Arch / KDE is the binding Linux target. Both editions share canonical document meaning.

## Status

Version 0.1.0 is the first public GitHub release. The unmerged 0.2 candidate on `codex/reference-library-feature-parity` restores the useful breadth of the original Pitch Deck Tools Asset Browser, then pushes the product beyond file browsing into deliberate editorial comparison and curation.

The candidate remains a draft until its exact head passes the full five-job CI matrix and the packaged application completes representative Apple-Silicon, Garuda/KDE and Mac → Garuda → Mac journeys. No draft branch or CI result authorizes a release.

See [Asset Browser parity](docs/product/ASSET_BROWSER_PARITY.md), [Editorial Shortlist and Compare](docs/product/EDITORIAL_SHORTLIST_AND_COMPARE.md), and the [feature-parity execution contract](docs/specs/FEATURE_PARITY_EXECUTION_CONTRACT.md).

## Download and install

Download the current stable 0.1.0 assets from [GitHub Releases](https://github.com/bomkino/reference-library/releases/latest). Verify the downloaded file against `SHA256SUMS` from the same release before opening it.

### Apple-Silicon macOS

1. Download `reference-library-0.1.0-macos-arm64.app.zip` and expand it.
2. Move `Reference Library.app` to `/Applications`.
3. On first launch, Control-click the app in Finder and choose **Open**. If macOS still blocks it, use **System Settings → Privacy & Security → Open Anyway**.

The app is ad-hoc signed but not notarized because this project does not use a paid Apple Developer membership. Do not remove quarantine attributes globally; approve this exact app through macOS instead.

### Linux x86_64

The stable release includes AppImage, pacman and tar distributions produced by exact-`main` Ubuntu CI. Ubuntu package/runtime rehearsal is verified; Garuda/KDE hardware integration is not yet claimed.

- AppImage: make `reference-library-0.1.0-x86_64.AppImage` executable, then run it.
- Arch/Garuda: install `reference-library-0.1.0-x64.pacman` with `sudo pacman -U`.
- Portable fallback: expand `reference-library-0.1.0-x64.tar.gz` and run the bundled executable.

## Unreleased 0.2 candidate

- broad honest catalogue support across images, design files, documents, video, audio, fonts and archives
- Grid, Compact and List browsing
- optional related-thumbnail mosaics
- category, extension, media-family, tag, Used In, Root, review, availability and Collection facets
- name, date, review-state and file-size sorting
- native Open Original, Reveal Source and Copy Path actions without exposing paths to the embedded workspace
- opt-in 60-second Root rescanning
- durable tags and Used In provenance
- bounded Shortlist across filters and paging
- side-by-side Compare Board for up to four visual candidates
- batch review, tags, Used In and Collection membership for up to 32 shortlisted Assets
- rapid review shortcuts: `1` Keep, `2` Maybe, `3` Reject, `0` Clear review, `X` shortlist, `C` compare
- revision-safe writes that refresh each Asset immediately before rapid or batch curation

Catalogue support and preview support remain separate. Material without a trusted renderer stays visible, searchable, curatable, openable and revealable as catalogue-only; it is never silently dropped or falsely presented as previewable.

## Stable 0.1 scope

- project-local `.pitchlibrary` package
- authorized Root add, reconnect and rescan
- stable Asset identity across supported external renames
- bounded still-image thumbnails and previews
- manual review, title and note curation
- lexical query, filters, sorting and flat Collections
- native reveal and opaque resource delivery
- bounded cross-host canonical proof

Source mutation, similarity, duplicate review, nested or smart Collections, MCP and automatic application updates remain deferred.

## Repository map

- `crates/`: shared Rust protocol and Core
- `packages/`: shared bridge contract and editorial workspace
- `apps/`: native platform shells
- `migrations/`: canonical SQLite migrations
- `scripts/`: verification, packaging and evidence tools
- `docs/`: product, architecture, security, maintenance and receipts
- `fixtures/`: tiny committed fixtures; large fixtures are generated

Read `AGENTS.md`, `CONTEXT.md` and `docs/specs/FEATURE_PARITY_EXECUTION_CONTRACT.md` before changing candidate source.

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

`cargo audit` is mandatory in CI through pinned `cargo-audit` 0.22.2. macOS source verification adds `swift test --package-path apps/macos`.

See [repository maintenance](docs/maintenance/REPOSITORY_MAINTENANCE.md) for package gates, evidence rules and branch cleanup.

## Licence

GNU Affero General Public License v3.0. See `LICENSE`.
