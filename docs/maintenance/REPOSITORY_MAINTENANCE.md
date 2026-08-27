# Repository Maintenance

This file describes how Reference Library stays reproducible, reviewable and honest after V1 source closure.

## Canonical state

`main` is the only canonical branch. Work happens on short-lived branches. Merge only after the exact branch head passes the complete required workflow. Delete merged branches when the available GitHub interface permits it; never preserve a branch merely as informal release evidence.

No tag or GitHub release should exist until the relevant packaged journey has passed on representative Apple Silicon and Garuda/KDE hardware. Workflow artifacts are retained build evidence, not public releases.

## Toolchain policy

- `.node-version` pins the Node major used locally and by every Node CI job.
- `rust-toolchain.toml` pins Rust, Clippy and rustfmt.
- `Cargo.toml` `rust-version`, the Rust toolchain file and all CI Rust actions must agree.
- Toolchain movement is an explicit maintenance change. Run the full matrix and regenerate dependency/licence evidence when dependency resolution changes.

`scripts/check_repository.py` enforces these relationships and the repository boundary.

## Required workflow jobs

| Job | Evidence |
| --- | --- |
| `repository-boundary` | required files, product icon and release metadata |
| `rust-core` | RustSec audit, format, Clippy, Core tests and semantic round trips |
| `workspace-and-linux-source` | npm audit, type checks, shared/Linux tests, builds and legal bundle |
| `linux-package-directory` | pacman/AppImage/tar assembly, extraction, sandbox refusal, X11/Wayland rehearsals, checksums and receipt |
| `macos-arm64-package` | Swift tests, app build, extraction, ad-hoc signature, checksums and receipt |

Every job has a hard timeout. Superseded branch runs cancel automatically; `main` runs do not.

## Claim boundaries

- **Source-ready:** source and available CI pass at an exact revision.
- **Packaged in a compatible runner:** an artifact assembled and passed its declared runner checks.
- **Target-integrated:** the installed journey passed on representative target hardware.
- **Released:** a deliberate tag and public release exist.

Never collapse these terms. A compatible Ubuntu or macOS runner cannot close M1, L1, X1 or C1 by itself.

## Evidence and receipts

Append decisions to `docs/evidence/DECISION_EVIDENCE_LOG.md`; do not rewrite prior entries. Exact-source receipts may link immutable commits, workflow runs, artifact IDs and checksums. Prefer dynamic `main` status in general documentation so a maintenance commit does not leave a stale “latest” SHA behind.

Generated package artifacts belong in workflow storage, not Git history. Keep large proof corpora and client assets out of the repository.

## Public hygiene

Do not put a client `.pitchlibrary`, original media, private filesystem paths, unredacted logs or screenshots into public issues. Reduce failures to synthetic fixtures. Keep issues and branches tied to actionable work; close or remove obsolete scaffolding after integration.
