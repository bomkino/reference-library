# V1 Run Ledger

## Starting truth

- Recovery branch: `recover/canonical`
- Intended integration branch: `codex/reference-library-v1-completion`
- Start commit: `8afdfa1f84b5421f3423f6d0df6c07b48229f944`
- Start tree: `e2bc259dad72823db174efd065d272d368e9ee71`
- Starting state: clean T02 source-ready source; M1, L1, X1 and C1 open.
- Authority: safe reversible source work, causal commits, branch synchronization and CI only. No merge, deployment, public release, force-push or repository-settings change.

This ledger is append-only. A row advances only after a fresh public-seam measurement. Source compilation or compatible packaging cannot close a target gate.

## Baseline reconciliation

The durable recovery checkout starts exactly from the expected T02 source. No newer repository work required reconciliation and no reset or discard was performed. Causal recovery commits are intended for ordered integration onto `codex/reference-library-v1-completion`.

## Baseline capability truth

| Ledger item | T02 baseline truth | Required fresh proof before completion |
| --- | --- | --- |
| V1-01 safe schema evolution | Migration 1 only; no editorial/Collection schema | Full identity-preserving upgrade fixture, injected-boundary atomicity, two recovery cycles, preserved integrity failure |
| V1-02 Root inventory/reconnect | Add/scan/cancel plus conservative external rename reconciliation; no daily-use inventory/reconnect seam | Stable-ID reauthorization, bounded jobs, typed denial, distinct host truth and relative path projection |
| V1-03 real renditions | Original common-still resource may be authorized as `grid_standard`; no decoding/downsampling provider | Pixel/byte envelope, cache key/invalidation, hostile-input denial, concurrency/memory/cancellation and opaque streaming |
| V1-04 manual curation | Planned; absent at baseline | Atomic review/title/note commands, bounds, normalization, durability and canonical parity |
| V1-05 lexical query | Deterministic offset paging only | Lexical query, filters/sorts, punctuation/Unicode behavior, combination paging and 100,000-Asset bounds |
| V1-06 flat Collections | Planned; absent at baseline | CRUD/membership atomicity, idempotency, deletion safety and canonical checks |
| V1-07 daily-use workspace | T01 Contact Sheet, stable selection and independent Interface Scale/grid density | Integrated Root/query/curation/Collection/Preview zoom, keyboard/accessibility and preference-exclusion proof |
| V1-08 package-open/runtime rehearsal | Compatible archives and structural listing; target integration unproved | Serialized package-open, safe fresh extraction, packaged helper journey, Xvfb smoke and honest Wayland boundary |
| V1-09 bounded canonical proof | Small whole-document T01 dump only | Snapshot-bound digest/pages, serious-library bounds and curation/Collection host-neutral zero diff |
| V1-10 source-ready closure | Not eligible | Exact-head Spec/Standards reviews, complete fresh matrix, receipt, synchronization and CI |

## Target gates

| Gate | Baseline status | Closure evidence |
| --- | --- | --- |
| M1 | Open | Exact installed Apple-Silicon artifact and full target journey |
| L1 | Open | Exact installed Garuda/Arch/KDE artifact under Wayland and X11 |
| X1 | Open | Exact M1/L1 builds complete Mac → Garuda → Mac with bounded zero-diff proof |
| C1 | Open | ADR-004/ADR-006 decision from M1/L1/X1 production-topology evidence |

## Planned source verification

```text
python3 scripts/check_repository.py
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run check
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
python3 scripts/generate_dependency_licenses.py
node scripts/t01-semantic-roundtrip.mjs --core target/debug/reference-core
git diff --check
```

## Append-only measurements

### 2026-08-27 — V1 contract freeze

**Hypothesis:** a frozen clause-by-clause completion ledger prevents broad implementation work from substituting file existence or compatible-runner evidence for public-seam and target proof.

**Change:** added the binding V1 execution contract and recorded exact T02 baseline truth for V1-01 through V1-10 plus M1, L1, X1 and C1.

**Fresh measurement:** `python3 scripts/check_repository.py` reported `repository boundary OK: 10 required files; no forbidden corpus`; `git diff --check` passed from the exact T02 base.

**Decision:** keep every item open until its named seam passes freshly.

### 2026-08-27 — Recover bounded host-neutral proof harness

**Hypothesis:** V1 canonical integration can be prepared without duplicating unfinished Core implementation by isolating a digest-bound page collector and a three-host-label semantic journey behind the declared V1 protocol.

**Change:** added the host-neutral proof specification, a bounded `canonical_digest`/`canonical_page` collector, three standalone contract tests and an Electron → Swift → Electron script carrying two curated Assets plus one Collection with three memberships. The legacy T01 semantic script remains unchanged and runnable against the T02 base.

**Fresh measurement:** `node --check` passed for the collector and V1 journey; the three new collector tests passed; after an offline locked dependency install and T02 Core build, `npm test` passed 5 script, 6 workspace and 8 Linux tests; repository boundary and diff checks passed.

**Decision:** keep the harness as integration-ready source evidence. Do not claim V1-09 or host parity until the V1 Core commands exist and the full journey passes; do not claim X1 from host-neutral labels.

### 2026-08-27 — V1 source and compatible-runtime closure

**Hypothesis:** the frozen V1 ledger can be closed without target overclaim only when every public seam, worst-case bound, host adapter, package runtime and neutral semantic projection passes freshly from one exact source tree.

**Change:** completed sequential editorial/Collection migrations, Root lifecycle and typed error matrix, real bounded renditions with supervised hard-timeout recovery, manual curation, composed lexical query, flat Collections, independent workspace controls, package-open serialization, session-owned opaque streams, safe compatible packaging, X11/Wayland rehearsals, bounded canonical proof, deterministic product identity and pinned RustSec auditing. Added no post-V1 capability.

**Fresh measurement:** local format/Clippy and 81 Rust, 24 script, 26 workspace and 55 Linux tests passed; both npm audits reported zero vulnerabilities; the 74-package legal closure, repository/icon/release checks and T01/V1 zero-diff journeys passed. GitHub Actions run `33080333170` passed all five jobs at remote source `04c54f3337a084f84420d103923fc9df262b7ada`, tree `5afd2d576e6d7f1a0df6c7ff369f36c8d91951a2`, including RustSec scanning, warning-free Apple arm64 packaging and full pacman/AppImage/tar X11/Wayland runtime rehearsal. Exact-source artifacts `9649807083` and `9649934123` are retained through 26 September 2026.

**Decision:** V1 source implementation is complete. Mark V1 source-ready only after this review/receipt head passes exact CI. Keep M1, L1, X1 and C1 open; do not merge, deploy or release.


### 2026-08-27 — Superseding packaged Wayland close proof

**Hypothesis:** the receipt-head Wayland failure was a proof-harness race because the renderer scheduled `window.close()` at zero delay and could close its DevTools socket before the command acknowledgement, while the same packaged source had passed the complete Wayland journey twice immediately before.

**Change:** made the packaged journey await a DevTools acknowledgement before a 250 ms delayed window close and added a regression seam that rejects the zero-delay close. Product behavior and package contents remain unchanged.

**Fresh measurement:** the focused test, 25 script, 26 workspace and 55 Linux tests passed locally. GitHub Actions run `33082121964` passed all five jobs at remote source `05b8f0e2ae1a0419426317d3183615a98f7179fe`, tree `01835315338858e0ad73ade01e6a99f5d658299c`, including the extracted pacman application journey under X11 and a real headless Wayland compositor, acknowledged close, clean exit, source-bound package receipts, pinned RustSec audit and warning-free Apple arm64 packaging. Artifacts `9650628469` and `9650719750` are retained through 26 September 2026.

**Decision:** keep the causal harness fix and supersede run `33080333170` with `33082121964` as the final reviewed implementation measurement. Source-ready closure still requires the following evidence-only head to pass exact CI; M1, L1, X1 and C1 remain open.
