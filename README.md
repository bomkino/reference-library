# Reference Library

Reference Library is a project-specific, private visual research and source-organising application for pitch-deck work. It is local, account-free, telemetry-free and intentionally has no embedded AI.

One project gets one `.pitchlibrary` package. Apple-Silicon macOS is primary; Garuda Linux / Arch / KDE is the binding Linux target. Both editions share canonical document meaning.

## Status

T01, the first production tracer, is under construction. Nothing in this repository is yet target-integrated on Apple Silicon or Garuda.

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
