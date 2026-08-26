# Reference Library

Reference Library is a project-specific, private visual research and source-organising application for pitch-deck work. It is local, account-free, telemetry-free and intentionally has no embedded AI.

One project gets one `.pitchlibrary` package. Apple-Silicon macOS is primary; Garuda Linux / Arch / KDE is the binding Linux target. Both editions share canonical document meaning.

## Status

T01, the first production tracer, is **source-ready**. Core, workspace and both native shell sources pass CI; compatible runners assemble the Linux package directory and the ad-hoc-signed Apple-Silicon app ZIP.

Nothing is yet target-integrated on representative Apple Silicon or Jenai's Garuda system. M1, L1, X1 and C1 remain explicit gates.

## Repository shape

- `crates/`: shared Rust protocol and core
- `packages/`: shared workspace and bridge contract
- `apps/`: platform shells
- `migrations/`: canonical SQLite migrations
- `docs/`: product, architecture, security and evidence records
- `fixtures/`: tiny committed fixtures; large fixtures are generated

Read `AGENTS.md`, `CONTEXT.md` and `docs/specs/TRACER_T01.md` before changing source.

## Licence

GNU Affero General Public License v3.0. See `LICENSE`.
