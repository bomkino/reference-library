# Repository Maintenance

This file describes how Reference Library stays reproducible, reviewable and honest.

## Canonical state

`main` is the only canonical branch. Work happens on short-lived branches. Merge only after the exact branch head passes the complete required workflow. Delete merged branches when the available GitHub interface permits it; never preserve a branch merely as informal release evidence.

GitHub Releases is the publication authority. A version in source, a tag without a release, a workflow artifact or a green branch run is not by itself a public release. Published packages must come from the exact `main` revision named by the tag and release receipt. Never move an existing release tag to newer source.

The historical 0.1.0, 0.2.0 and 0.3.0 notes and receipts describe their own release decisions. They remain frozen evidence, not the maintenance policy for later versions. A factual post-publication status correction must label itself explicitly and must not rewrite feature history.

## Toolchain policy

- `.node-version` pins the Node major used locally and by every Node CI job.
- `rust-toolchain.toml` pins Rust, Clippy and rustfmt.
- `Cargo.toml` `rust-version`, the Rust toolchain file and all CI Rust actions must agree.
- Toolchain movement is an explicit maintenance change. Run the full matrix and regenerate dependency/licence evidence when dependency resolution changes.

`scripts/check_repository.py` enforces these relationships and the repository boundary.

## Required exact-main workflow

| Job | Evidence |
|---|---|
| `repository-boundary` | required files, product icon and release metadata |
| `rust-core` | RustSec audit, format, Clippy, Core tests and semantic round trips |
| `workspace-and-linux-source` | npm audit, type checks, shared/Linux tests, builds and legal bundle |
| `linux-package-directory` | Synthetic visual layout audit, pacman/AppImage/tar assembly, extraction, sandbox refusal, X11/Wayland rehearsals, checksums and receipt |
| `macos-arm64-package` | Swift tests, app build, extraction, ad-hoc signature, checksums and receipt |

Every job has a hard timeout. Superseded branch runs cancel automatically; `main` runs do not. A release may be assembled only after all five required jobs pass for the exact tagged `main` commit.

## Version and release checklist

1. Choose a new semantic version and monotonically increasing build number. Do not reuse published metadata.
2. Update every package, host, workflow, receipt and release-metadata declaration that participates in shipped filenames or application identity.
3. Add the changelog entry and `docs/releases/<version>.md`. State open target gates and user-visible compatibility honestly.
4. Regenerate dependency licences and notices whenever a shipped dependency or bundled third-party asset changes.
5. Run repository, Rust, shared workspace, native-host and packaging checks on the candidate branch.
6. Merge the reviewed candidate to `main`, then require the full five-job workflow on that exact commit.
7. Create the immutable version tag and deliberate GitHub Release only after explicit publication authority. A pre-existing version tag must resolve to the exact verified source commit or publication fails. Attach checksums and source-bound receipts to the public artifacts.
8. Record the exact commit, workflow, artifacts and checksums in a release receipt. Do not describe publication as complete before the tag and GitHub Release are observable.

When changing bundled fonts, preserve the upstream tag, full commit, licence and SHA-256 for every binary in `THIRD_PARTY.md`. Fonts must be served from local application resources; runtime GitHub fetches, authentication and client-side tokens are prohibited. Do not copy upstream CSS, tokens or documentation unless their licence independently permits it.

## Claim boundaries

- **Source-ready:** source and available CI pass at an exact revision.
- **Packaged in a compatible runner:** an artifact assembled and passed its declared runner checks.
- **Target-integrated:** the installed journey passed on representative target hardware.
- **Released:** a deliberate immutable tag and public GitHub Release exist.

Never collapse these terms. A compatible Ubuntu or macOS runner cannot close M1, L1, X1 or C1 by itself.

## Evidence and documentation history

Append decisions to `docs/evidence/DECISION_EVIDENCE_LOG.md`; do not rewrite prior entries. Exact-source receipts may link immutable commits, workflow runs, artifact IDs and checksums. Prefer dynamic `main` status in general documentation so a maintenance commit does not leave a stale “latest” SHA behind.

Completed execution contracts, migrations, evidence receipts and release notes are historical records. Correct a factual typo with an explicit note when necessary; never mass-replace their period-specific version, status or capability claims to make them read as current policy. The documentation map distinguishes living guidance from frozen evidence.

Generated package artifacts belong in workflow storage, not Git history. Keep large proof corpora and client assets out of the repository.

## Public hygiene

Do not put a client `.pitchlibrary`, original media, private filesystem paths, unredacted logs or production screenshots into public issues or documentation. Reduce failures to small synthetic fixtures co-located with tests or freshly generated at test time; there is no committed media corpus. Public layout screenshots must use synthetic, scrubbed content and reveal no local path or client material.

Keep issues and branches tied to actionable work. Close superseded issues, remove obsolete scaffolding after integration and delete merged branches when permitted. Never delete a release receipt, migration or other durable historical evidence as routine cleanup.
