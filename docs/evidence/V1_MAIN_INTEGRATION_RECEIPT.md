# V1 Main Integration Receipt

## Verdict

V1 is **merged and canonical on `main`** by fast-forward. Exact-`main` CI passed. This receipt proves source integration and compatible packaging; it does not claim installed target integration or a public release.

## Source identity

| Surface | Evidence |
|---|---|
| Repository | https://github.com/bomkino/reference-library |
| Previous `main` | `622237237e4492292df91b8912f9109cb3a0bf1e` |
| Integrated V1 commit | `2158fbb99260697ba158afcb048bef621f087c82` |
| Relationship | 118 commits ahead, zero behind; old `main` is the merge base |
| Integration method | Non-forced fast-forward (`force:false`) |
| Exact-main CI | [Run `33120794811`](https://github.com/bomkino/reference-library/actions/runs/33120794811), five of five jobs passed |
| Integrated | 27 August 2026 UTC |

## Exact-main verification

- repository boundary, deterministic icon and release metadata passed;
- pinned RustSec audit, format, all-target Clippy, 81 Rust tests and both semantic journeys passed;
- TypeScript, 25 script, 26 workspace and 55 Linux tests plus production builds and legal closure passed;
- Apple-Silicon Swift tests, warning-free arm64 build, extracted app validation, ad-hoc signature, checksums and source receipt passed;
- Linux pacman/AppImage/tar assembly, safe extraction, renderer boundary, sandbox ownership, packaged X11/Wayland journeys, packaged-helper reopen, checksums and source receipt passed.

## Canonical main artifacts

| Artifact | ID | Size | Workflow-container SHA-256 | Expires |
|---|---:|---:|---|---|
| Apple arm64 `.app.zip` | `9666411956` | 2,758,287 bytes | `46466368be45f203592d30170aeedc1f6f8241f79e5ab415e9374831d085463e` | 26 September 2026 |
| Linux x86_64 pacman/AppImage/tar bundle | `9666523446` | 340,870,137 bytes | `cf63aac91c147375739b4e11b497db49d4c265d9edd592a755a5686632d36af9` | 26 September 2026 |

These are expiring CI artifacts, not installed applications or a public GitHub release. Each contains exact-source checksums and a V1 build receipt.

## Remaining gates

- **M1:** representative Apple-Silicon installation and journey.
- **L1:** representative Garuda/Arch/KDE installation and Wayland/X11 journey.
- **X1:** exact installed-build Mac → Garuda → Mac zero-diff journey.
- **C1:** accept or replace ADR-004 and ADR-006 from target evidence.
- **Public release:** not created; requires a separate explicit release action.
