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
