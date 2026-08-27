# V1 Source-Ready Evidence Receipt

## Identity

```text
Repository: https://github.com/bomkino/reference-library
Branch: codex/reference-library-v1-completion
Start commit: 8afdfa1f84b5421f3423f6d0df6c07b48229f944
Start tree: e2bc259dad72823db174efd065d272d368e9ee71
Reviewed local implementation end: c0b78116f8d7326474819815fd52b4a1c57f82f4
Reviewed remote implementation end: 05b8f0e2ae1a0419426317d3183615a98f7179fe
Reviewed implementation tree: 01835315338858e0ad73ade01e6a99f5d658299c
Implementation CI: 33082121964
Local environment: Linux 6.18.35 x86_64
Rust: 1.98.0; Node: 24.19.0; npm: 11.9.0; Python: 3.12.13
Recorded: 27 August 2026 UTC
```

The local and synchronized GitHub implementation commits have different commit-object SHAs because synchronization used Git data operations, but their tree `01835315338858e0ad73ade01e6a99f5d658299c` is identical. The evidence-only review/receipt commit follows that implementation tree and changes no product behavior.

## Result

The V1 daily-use still-image Library is **source-ready**. V1-01 through V1-09 pass at their public source seams; compatible CI compiles both hosts, packages Apple arm64 and Linux x86_64 artifacts, and exercises the packaged Linux app under X11 and a real headless Wayland compositor. V1-10 is complete when this evidence head passes exact-source CI.

This is not installed target integration. M1, L1, X1 and C1 remain open. No merge, deployment, public release, force-push or repository-settings change occurred.

## Causal source history

The reviewed implementation contains 93 causal source/review commits after the exact T02 base. The principal vertical slices are:

| Slice | Representative commits | Result |
|---|---|---|
| Contract, protocol and provenance | `e575c2a`, `f4c9b0a`, `7e76c84`, `62101fe` | Frozen V1 ledger, typed public protocol and shipped legal closure |
| Schema, identity and recovery | `6a659a5`, `875933a`, `e55c404`, `72088da` | Sequential migration/ledger integrity, exact rollback, WAL/two-crash recovery and preserved IDs |
| Root and rendition Core | `7c31dc2`, `285bf39`, `56cdd62`, `69b0a1b`, `c8a2822`, `b402417` | Reconnect/rescan/jobs, real bounded still renditions, path-free errors and hard process containment |
| Editorial domain and canonical proof | `4645d6e`, `fbc5020`, `e67c015`, `d4c6cb0`, `820b86b`, `fa12e86` | Manual curation, flat Collections, composed lexical paging and bounded neutral digest/pages |
| Shared workspace | `6a2f45a`, `dc9becd`, `64ca4d0`, `bd6797f`, `dd996d0` | Daily-use Contact Sheet, stable selection/focus, independent controls and bounded event/page handling |
| Native hosts and authority | `f7ad97e`, `04006ae`, `53079b1`, `3d107c1`, `01f1d52`, `dd7e72a`, `ecd2172` | Fixed bridges, package-open serialization, opaque streaming, session revocation and warning-clean host builds |
| Compatible packaging/runtime | `087b9f8`, `4c3f4e7`, `03b3a7f`, `1cb0aaf`, `3686dba`, `7fb1c39`, `c0b7811` | Source-bound receipts, safe extraction, product icon, sandboxed X11/Wayland journeys, acknowledged clean-close proof and complete preload bundle |
| Closure proofs | `addb791`, `3b252ea`, `a2f8185`, `0a1690f` | Worst-case frames, hostile package inputs, honest Root rebind semantics and pinned RustSec audit |

## Files and architecture

- `migrations/0002_v1_domain.sql` and `0003_rendition_jobs.sql` add editorial/Collection state and disposable rendition jobs under the one-writer migration ledger.
- `crates/reference-core` owns package/SQLite truth, Root authority binding, progressive scanning, editorial transactions, lexical queries, real bounded renditions, framed supervision and bounded canonical proof.
- `crates/reference-protocol` defines the versioned command/result/event/error contract and all public bounds.
- `packages/bridge-contract` exposes fixed host operations; `packages/workspace` implements the shared bounded Editorial Contact Sheet and daily-use controls.
- `apps/linux` contains the hardened Electron supervisor, exact wire validation, authority transitions, package-open queue, private opaque-resource streaming and pacman/AppImage/tar configuration.
- `apps/macos` contains the SwiftUI/WebKit host, security-scoped grant transactions, exact Core validation, serialized transitions, private streamed resources and arm64 `.app.zip` packaging.
- `scripts` contains source-bound receipt/checksum validation, safe artifact extraction, packaged X11/Wayland journeys and T01/V1 host-neutral semantic proof.
- `assets/branding` contains the deterministic product icon. Legal/provenance files are generated from locked shipped graphs.

## Fresh local public-seam measurements

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
  pass: 81 Rust tests

npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
  pass: 25 script tests; 26 workspace tests; 55 Linux tests
  pass: production workspace and hardened Linux builds

npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
  pass: 0 vulnerabilities in both audits

python3 scripts/generate_dependency_licenses.py --check
  pass: 74 locked shipped packages

python3 scripts/check_repository.py
node scripts/generate-product-icon.mjs --check
node scripts/check-release-metadata.mjs
git diff --check
  pass: repository boundary, deterministic product icon, release metadata and diff checks

node scripts/t01-semantic-roundtrip.mjs --core target/debug/reference-core
  pass: 3 Assets; stable Library ID; semanticDiffCount 0

node scripts/v1-semantic-roundtrip.mjs --core target/debug/reference-core
  pass: 3 Assets; 2 curated; 1 Collection; 3 memberships;
  stable Library ID; semanticDiffCount 0

node --test apps/linux/tests/core-supervisor.integration.test.mjs
  pass: honest Root rebind lifecycle and real decode-boundary timeout 2/2
```

The timeout proof reaches a dual-gated debug hook immediately before third-party decode, then proves a two-second request timeout, `SIGKILL`, fail-all semantics, one fixed restart event, Core restart/reopen and unchanged canonical digest. Release builds compile the hook as a no-op.

## Exact-source CI and compatible packages

GitHub Actions run [`33082121964`](https://github.com/bomkino/reference-library/actions/runs/33082121964) passed all five jobs at synchronized source `05b8f0e2ae1a0419426317d3183615a98f7179fe`, tree `01835315338858e0ad73ade01e6a99f5d658299c`:

- repository boundary, deterministic icon and release metadata;
- Rust format, all-target Clippy, 81 tests and both zero-diff semantic journeys;
- pinned `cargo-audit` 0.22.2 loaded 1,226 RustSec advisories and scanned 78 locked Rust dependencies with no vulnerability finding;
- TypeScript, 25 script, 26 workspace and 55 Linux tests, production builds, npm audit and the 74-package legal closure;
- Apple-Silicon Swift tests, warning-free release compilation, `aarch64-apple-darwin` Rust Core, extracted `.app`, entitlements/architecture/resources, ad-hoc codesign, checksums and exact-source receipt;
- Linux pacman/AppImage/tar assembly, safe fresh extraction, executable/ASAR/helper/desktop/MIME/legal/version validation, renderer-boundary validation, reproduced `root:root:4755` Chromium sandbox, packaged app journeys under X11 and real headless Wayland, acknowledged renderer close and clean process exit, packaged-helper reopen, checksums and exact-source receipt.

| CI artifact | ID | Size | Workflow-container SHA-256 | Expires |
|---|---:|---:|---|---|
| `reference-library-linux-x86_64-05b8f0e2ae1a0419426317d3183615a98f7179fe` | `9650719750` | 340,883,733 bytes | `0b09a8a880e4d84c459293f802f2cbbf72e9097bbdf369728f93bf6d0a21ab35` | 26 September 2026 |
| `reference-library-macos-arm64-05b8f0e2ae1a0419426317d3183615a98f7179fe` | `9650628469` | 2,758,286 bytes | `ff76b5b5356300c791f82d0040ef2cbbb5c0b7a46370fac71d1a22435d1082de` | 26 September 2026 |

These are expiring CI artifacts, not installations or public releases. The workflow-container digest binds the uploaded ZIP; each artifact also contains verified per-package `SHA256SUMS` and a source/tree/target-specific V1 build receipt.

## Reviews

- `V1_SPEC_REVIEW.md`: V1-01 through V1-09 pass at the available seams. The synchronous decoder limitation is contained by the supervised process boundary and remains target-measured under C1.
- `V1_STANDARDS_REVIEW.md`: no Critical or High source defect across identity, migrations/recovery, renderer authority, privacy, accessibility source semantics, performance/bounds, packaging or provenance.

## Honest status

| Area | Status | Remaining proof |
|---|---|---|
| Canonical Core and V1 document meaning | Source-ready | C1 target topology decision |
| Shared editorial workspace | Source-ready | M1/L1 assistive-technology and compositor behavior |
| Electron/Linux package set | Packaged and exercised in compatible Ubuntu x86_64 CI under X11/Wayland | L1 Garuda/Arch/KDE installation and integration |
| Swift/macOS package | Compiled and packaged on Apple-Silicon CI; ad-hoc signed | M1 installed Apple-Silicon integration, Developer ID/notarization for release |
| Cross-host document meaning | Host-neutral Mac-labelled → Linux-labelled → Mac-labelled semantic diff 0 | X1 using exact installed M1/L1 builds |

## Remaining gates

- **M1:** install the exact source-bound arm64 `.app.zip` on representative Apple Silicon; exercise package-open, APFS discovery/rename/reconnect, bookmark lifecycle, real rendition/Preview, Finder reveal, curation/query/Collections, crash/WAL recovery, independent scales, keyboard and VoiceOver; record hardware, macOS, artifact SHA-256 and signing/Gatekeeper state.
- **L1:** install the exact Linux package set on representative Garuda/Arch/KDE; exercise pacman plus AppImage/tar, package-open, filesystem rename/reconnect, KDE dialog, Dolphin reveal, renditions, opaque Preview, curation/query/Collections, crash/WAL recovery, fractional scaling, keyboard and Orca under Wayland and X11; record hardware, OS/session and artifact SHA-256.
- **X1:** with the exact M1/L1 builds and one real Library, complete Mac → Garuda → Mac including reauthorization, curation and Collection edits, rename and Missing/restore; bounded counts/digest/pages must return with zero unexplained semantic diff.
- **C1:** accept or replace ADR-004 and ADR-006 only from M1/L1/X1 evidence for launch/signing/bundling, one-writer/WAL recovery, cancellation/backpressure, opaque resources, renderer containment and same-document meaning.
- **Release authority:** even after M1/L1/X1/C1, publishing requires explicit authority. No tag or release was created here.

## Limitations

- `DynamicImage::from_decoder` is synchronous and cannot be interrupted inside third-party code. Cooperative cancellation surrounds it; the supervised Core process is the hard timeout boundary. Target behavior remains C1.
- CI arm64 packaging is not a clean-account Gatekeeper, security-scoped bookmark, Finder or VoiceOver integration run.
- Ubuntu X11/Wayland rehearsal is not Garuda/KDE, Dolphin, Orca, fractional-scaling or representative-filesystem integration.
- Ad-hoc signing is not Developer ID signing or notarization.
- Post-V1 features remain absent by contract.

## Next exact vertical slice

Run M1 with artifact `9650628469` and its embedded source receipt. In parallel, L1 may run with artifact `9650719750`; do not claim X1 or close ADR-004/ADR-006 until both installed target receipts exist.
