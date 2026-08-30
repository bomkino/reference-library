# Reference Library

[![CI](https://github.com/bomkino/reference-library/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bomkino/reference-library/actions/workflows/ci.yml)

Reference Library is a project-specific, local-first visual research and source-organising application for pitch-deck work. It has no account, telemetry, cloud dependency or embedded AI.

One project gets one `.pitchlibrary` package. Apple-Silicon macOS is primary. Garuda Linux / Arch / KDE is the binding Linux target. Both editions share canonical document meaning.

## Status

**This source tree targets Reference Library 0.3.1 (build 4).** GitHub Releases is the authority for whether a version is public; source version metadata or a green branch run alone is not a release.

0.3.1 is a visual-craft patch over 0.3.0. It keeps the locally bundled pitch.dog Type System v13 fonts and Phosphor icons, then tightens container alignment, caret and icon rhythm, control heights, clipping, overflow and expansion motion. It changes no `.pitchlibrary` schema or canonical document meaning.

Public binaries are built from exact `main`, validated by the five-job CI matrix, and published with SHA-256 checksums and source-bound build receipts. Representative Apple-Silicon, Garuda/KDE and Mac → Garuda → Mac target-machine journeys remain open evidence gates; publication does not close them.

See the [0.3.1 release notes](docs/releases/0.3.1.md), [interface system](docs/product/BRUTALIST_INTERFACE_SYSTEM.md), [Asset Browser parity](docs/product/ASSET_BROWSER_PARITY.md), [Editorial Shortlist and Compare](docs/product/EDITORIAL_SHORTLIST_AND_COMPARE.md), and [documentation map](docs/README.md).

## Download and install

Download the newest published version from [GitHub Releases](https://github.com/bomkino/reference-library/releases/latest). Verify the downloaded file against `SHA256SUMS` from the same release before opening it. For 0.3.1, use the filenames below from the matching `v0.3.1` release.

### Apple-Silicon macOS

1. Download `reference-library-0.3.1-macos-arm64.app.zip` and expand it.
2. Move `Reference Library.app` to `/Applications`.
3. On first launch, Control-click the app in Finder and choose **Open**. If macOS still blocks it, use **System Settings → Privacy & Security → Open Anyway**.

The app is ad-hoc signed but not notarized because this project does not use a paid Apple Developer membership. Do not disable Gatekeeper or clear quarantine globally; approve this exact app instead.

### Linux x86_64

- AppImage: make `reference-library-0.3.1-x86_64.AppImage` executable, then run it.
- Arch/Garuda: install `reference-library-0.3.1-x64.pacman` with `sudo pacman -U`.
- Portable fallback: expand `reference-library-0.3.1-x64.tar.gz` and run the bundled executable.

Ubuntu CI validates the packages and packaged X11/Wayland journeys. This is compatible-runner evidence, not a claim that representative Garuda/KDE hardware integration is complete.

## What 0.3.1 changes

- Rebalances icons, labels and carets inside controls and disclosure headers.
- Normalizes caret size, icon/label gaps, control heights and panel insets.
- Contains constrained text and controls without page-level overflow or clipped actions.
- Keeps drawers, filters and batch tools from reflowing the canvas; local disclosures expand with measured motion instead of an abrupt jump.
- Keeps transitions restrained, intent-led and compatible with reduced motion.
- Retains the locally bundled pitch.dog Type System v13 fonts, pinned Phosphor icons and 44 px minimum interactive-target floor introduced in 0.3.0.

## Product capabilities

### Broad, honest catalogue

- common images, design files, documents, video, audio, fonts and archives
- Grid, Compact and List browsing
- optional related-thumbnail mosaics
- category, extension, media-family, Tag, Used In, Root, review, availability and Collection facets
- name, date, review-state and file-size sorting
- native Open Original, Reveal Source and Copy Path without exposing absolute paths to the embedded workspace
- opt-in 60-second Root rescanning
- durable Tags and Used In provenance

Catalogue support and preview support remain separate. Material without a trusted renderer stays visible, searchable, curatable, openable and revealable as catalogue-only; it is never silently dropped or falsely presented as damaged.

### Editorial decision loop

- bounded 32-Asset Shortlist across filters and paging
- ordered first-four Compare slots
- four-up Compare Board with shared zoom and optional synchronized pan
- review, Tags and Used In context while comparing
- per-candidate Keep, Maybe, Reject, Open, Reveal and Copy Path
- batch review, Tags, Used In and Collection membership
- rapid review shortcuts: `1` Keep, `2` Maybe, `3` Reject, `0` Clear, `X` Shortlist, `C` Compare
- revision-safe writes with conflict-aware partial results

### Interface and journey

- clearer first-run and empty states
- stronger hierarchy and quieter editorial chrome
- responsive Inspector and narrow-window drawer behaviour
- preserved focus, keyboard order and modal isolation
- larger touch targets and independent Interface Scale, thumbnail density and Preview zoom
- reduced-motion support plus desktop and narrow-layout visual QA

## Core model

- project-local `.pitchlibrary` package
- authorized Root add, reconnect, rescan and optional automatic reconciliation
- stable Asset identity across supported external renames
- durable review, title, note, Tags, Used In and flat Collections
- private opaque preview delivery
- bounded cross-host canonical proof

Source mutation, similarity, duplicate review, nested or smart Collections, ratings, saved searches, MCP and automatic application updates remain deferred.

## Repository map

- `crates/`: shared Rust protocol and Core
- `packages/`: shared bridge contract and editorial workspace
- `apps/`: native platform shells
- `migrations/`: canonical SQLite migrations
- `scripts/`: verification, packaging and evidence tools
- `docs/`: living product/maintenance documents, frozen contracts, release notes and evidence receipts
- tests are co-located with each package or `scripts/tests/`; large and adversarial fixtures are generated at test time rather than committed as a media corpus

Read `AGENTS.md`, `CONTEXT.md`, the [documentation map](docs/README.md) and the relevant product, security and architecture documents before changing source.

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
