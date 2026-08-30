# Repository Instructions

Read `CONTEXT.md`, `docs/product/PRODUCT_CONSTITUTION.md`, `docs/specs/TRACER_T01.md`, `docs/security/SECURITY_MODEL.md`, `docs/maintenance/REPOSITORY_MAINTENANCE.md` and relevant ADRs before modifying source.

## Product rules

- Reference Library only. Do not add Deck Workbench or Font Lab work.
- No embedded AI, accounts, telemetry, cloud dependency or automatic creative judgment.
- Stable generated Asset IDs; paths belong to Locations.
- One project gets one Library.
- Original sources remain in place by default.
- Use named typed commands and opaque IDs. Never expose generic filesystem, shell, SQL, process or IPC powers to a renderer.
- Interface Scale, thumbnail density and media zoom are independent controls.
- Editorial Contact Sheet is the resting surface; no ambient autoplay or SaaS dashboard.
- Work in causal vertical slices. Test public seams, not coverage percentages.
- Keep `docs/evidence/DECISION_EVIDENCE_LOG.md` append-only.
- Never claim target integration without target-machine evidence.
- Never merge, release, deploy, force-push or change repository settings without authority.

## Toolchains

Use Node 24 from `.node-version` and Rust 1.90.0 from `rust-toolchain.toml`. Do not silently advance either pin. Update the pin, CI, dependency evidence and documentation together.

## Required source verification

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

CI additionally runs pinned RustSec auditing, exact Linux package extraction and runtime rehearsals, checksum/receipt verification, Swift tests and Apple-Silicon app packaging. Run `swift test --package-path apps/macos` on compatible macOS source changes.

A green compatible runner proves source-ready behavior only. M1, L1, X1 and C1 remain separate target-machine gates.

## Interface system

- Read `docs/product/BRUTALIST_INTERFACE_SYSTEM.md` before changing workspace presentation.
- Preserve independent Interface Scale, thumbnail density and Preview zoom.
- Keep ordinary targets at least `max(44px, 3.5rem)` in the root sizing system.
- Keep compact and icon-only targets at least `max(44px, 2.75rem)`; the visible icon may be smaller inside that target.
- Preserve Library and Inspector capability at supported narrow widths through explicit, focus-managed drawers; never remove their content to make a layout pass.
- Use the locally bundled CC0 pitch.dog v13 fonts: PD Body by default, PD Head for major editorial display and PD Eyebrow for literal metadata/data. Use authentic weight anchors only.
- Use pinned Phosphor icons through the shared `UiIcon` wrapper. Keep the product mark separate; do not add hand-drawn utility SVGs, CSS-mask icons or icon-like Unicode controls.
- Use `--space-1` through `--space-8` for component padding and gaps. Reserve fluid spacing for page and region gutters.
- Use one restrained signal colour. Do not add gradients, glass panels or dashboard-card styling.
- Keep frequent keyboard actions instant and respect `prefers-reduced-motion`.
- Generate product icon output through `scripts/generate-product-icon.mjs`; never hand-edit a derivative alone.
