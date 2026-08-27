# T02 Source-Ready Evidence Receipt

## Identity

```text
Repository: https://github.com/bomkino/reference-library
T02 base / verified T01 head: 858202c2bbf5f3427703ccf42414a1629d0f8a59
Branch: codex/reference-library-t02-rename-reconciliation
Reviewed implementation head: 3a55385afd21b32f2e7bb80a8b83661348e8d6b5
Reviewed tree: e6bfa93a528804e2498153f01bfedc2ff2f88f55
Spec/Standards review and CI source: 39c1a20f9ee1ef04af1774b69368dbe0d0ee8362
Original repository main: 622237237e4492292df91b8912f9109cb3a0bf1e
Local environment: Linux 6.18.35 x86_64
Recorded: 27 August 2026 UTC
```

## Result

T02 is **source-ready**. The bounded capability is external rename reconciliation: one unambiguous same-filesystem still rename preserves Source, SourceRevision, Location, AssetOrigin and Asset identity; insufficient evidence remains an explicit Missing Asset plus a distinct observation. Local public seams and exact source-bound CI passed.

This is not target integration. M1, L1, X1 and C1 remain open. No merge, release, deployment, force-push or repository-settings change occurred.

## Causal remote commits

| SHA | Purpose | Fresh evidence |
|---|---|---|
| `78edfc6` | Bind T02 contract and Design It Twice record from exact T01 head | Repository boundary and diff checks passed |
| `0ca5648` | Implement strict core rename reconciliation and original-path reactivation | 12 Rust tests, format and Clippy passed |
| `3a55385` | Preserve selection/Preview summaries and advertise capability without new authority | TypeScript, 6 workspace tests, 8 Linux tests and builds passed |
| `39c1a20` | Perform Spec/Standards reviews and record full local evidence | Five-job exact-source CI passed |

## Files and architecture

- `docs/specs/TRACER_T02.md` defines the accepted predicate, causal acceptance and non-goals.
- `docs/specs/T02_PUBLIC_SEAM_DESIGN.md` records rejected hash/path matching and extra-command shapes.
- `crates/reference-core/src/discovery.rs` captures host evidence and reconciles inside the existing scan transaction.
- `crates/reference-core/tests/t02_public_seams.rs` proves identity preservation, no hash-derived merge and Missing restoration.
- `packages/workspace/src/selection.ts` and `app.tsx` keep the editorial surface current by stable Asset ID.
- No migration, protocol command, bridge operation, renderer privilege or source-operation engine was added.

## Public-seam measurements

```text
python3 scripts/check_repository.py
  pass: 10 required files; no forbidden corpus

cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
  pass: 12 tests
  T02: 3/3 identity fixtures
  T01: package, restart, resource and 100,000-Asset window remain green

node scripts/t01-semantic-roundtrip.mjs --core target/debug/reference-core
  pass: 3 Assets; stable Library ID; semanticDiffCount 0

npm run check
  pass: TypeScript; 2 receipt tests; 6 workspace tests; 8 Linux tests;
  workspace and hardened shell production builds

npm audit --audit-level=high
npm audit --omit=dev
  pass: 0 vulnerabilities in both audits

python3 scripts/generate_dependency_licenses.py
git diff --exit-code -- DEPENDENCY-LICENSES.json
  pass: deterministic 473-package inventory unchanged

cargo tree --workspace --duplicates
  pass: nothing to print
```

## Compatible Linux package proof

```text
cargo build --release --locked -p reference-core
npm run package -w @pitchdog/reference-linux
  first attempt: pacman stopped because bsdtar was absent (exit 127)

PATH=<previously verified compatible bsdtar>:$PATH npm run package -w @pitchdog/reference-linux
  pass: pacman, AppImage and tar assembled

bsdtar -tf <pacman>; tar -tzf <tar.gz>
  pass: packaged executable paths present; release core and ASAR present
```

Local compatible-package SHA-256 values at the reviewed tree:

| Artifact | SHA-256 |
|---|---|
| `reference-library-0.1.0-x64.pacman` | `52e8470b501e9f4dcb6fd9051f5031cde00eeddec163fcfbe396425e98998494` |
| `reference-library-0.1.0-x86_64.AppImage` | `4caf8a6db20afd616b295ee942345a09254b240404132bbad59e02011162e4ea` |
| `reference-library-0.1.0-x64.tar.gz` | `0505469da4f884bbc46f26dd69bf66ccde833d08e84008871f24a8962a4c3322` |

These are local compatible-environment measurements, not releases or Garuda installation evidence.

## Exact source-bound CI and retained artifacts

GitHub Actions run [`33040429601`](https://github.com/bomkino/reference-library/actions/runs/33040429601) passed all five jobs at review/receipt source `39c1a20f9ee1ef04af1774b69368dbe0d0ee8362`:

- repository boundary;
- Rust format, Clippy, 12 tests and zero-diff semantic round-trip;
- TypeScript, receipt/workspace/Linux tests, production builds, dependency audit and licence inventory;
- complete Linux pacman/AppImage/tar assembly, archive checks and exact-source receipt;
- Apple-Silicon Swift tests, shared workspace build, `aarch64-apple-darwin` Rust core, ad-hoc codesign, `.app.zip` checksum and exact-source receipt.

| CI artifact | ID | Size | Workflow-container digest | Expires |
|---|---:|---:|---|---|
| `reference-library-linux-x86_64-39c1a20f9ee1ef04af1774b69368dbe0d0ee8362` | `9633709504` | 338,687,387 bytes | `sha256:a7eae930fbf465d3cabccaa2a23f828dad1936a738cce7f2a8c96dabb4cded8b` | 26 September 2026 |
| `reference-library-macos-arm64-39c1a20f9ee1ef04af1774b69368dbe0d0ee8362` | `9633656547` | 1,797,597 bytes | `sha256:ac1c477a56baf89c03081de9782302445621be3a4e5c81b947be86578062b21d` | 26 September 2026 |

These are expiring CI artifacts, not installations, releases or target-integration evidence.

## Spec and Standards reviews

- `T02_SPEC_REVIEW.md`: every bounded T02 requirement is satisfied at the available seam; conservative false negatives and the upgrade backfill requirement are explicit.
- `T02_STANDARDS_REVIEW.md`: no Critical or High source defect; identity, security, privacy, performance and scope boundaries remain intact.

## Honest status

| Area | Status | Remaining proof |
|---|---|---|
| T02 core reconciliation | Source-ready; local and CI public seams pass | M1/L1 filesystem behavior |
| Shared editorial workspace | Source-ready | M1/L1 assistive-tech and compositor behavior |
| Electron/Linux bundle | Packaged in compatible Linux x86_64 environments; retained CI artifact | L1 Garuda integration |
| Swift/macOS bundle | Compiled and packaged on Apple-Silicon CI; retained artifact | M1 target integration |
| Shared document meaning | Host-neutral semantic diff 0 | X1 installed Mac–Garuda–Mac journey |

## Remaining gates

- **M1:** install and exercise the exact Apple-Silicon package: APFS rename/rescan, bookmark lifecycle, opaque resource, Finder reveal, restart, keyboard and VoiceOver.
- **L1:** install and exercise the exact Garuda/KDE packages: rename/rescan on representative filesystem, Wayland/X11, dialogs, protocol, Dolphin, scaling, restart and Orca.
- **X1:** perform Mac → Garuda → Mac canonical round-trip with the installed T02 builds.
- **C1:** close the production Rust deployment decision only after target bundling, signing, WAL recovery and resource backpressure evidence.

## Explicit limits

- A T01-era Location must be observed once under T02 before host file identity is available for a later rename.
- Unsupported/ambiguous platform evidence and cross-volume moves fail closed into Missing plus a distinct observation.
- No app-initiated rename/move/copy/Trash, relink UI, duplicate/similarity work, Excerpts or later feature was added.
- The Linux package retains the known placeholder icon. Apple signing/notarization and release work remain outside this slice.
