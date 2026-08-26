# T01 Source-Ready Evidence Receipt

## Identity

```text
Repository: https://github.com/bomkino/reference-library
Expected and actual start SHA: 622237237e4492292df91b8912f9109cb3a0bf1e
Branch: codex/reference-library-tracer-01
Reviewed implementation head: c9db5624cadc4894c8dd34b27d52007a65321dd0
Spec/Standards review commit: 2472966c4bc66a205ca0b61019e5e5a115bc8ba8
Local environment: Linux 6.18.35 x86_64
CI environments: ubuntu-24.04 x86_64; macos-26 arm64
Recorded: 26 August 2026 UTC
```

## Result

T01 is **source-ready**. A user-facing workspace and both privileged shell adapters now cover the bounded tracer: create/open one `.pitchlibrary`, authorize one Root, discover JPEG/PNG/WebP progressively, browse a virtualized Editorial Contact Sheet, retain logical selection and focus as pages arrive, preview through a session-scoped opaque URL, reveal through a Location ID, close, reopen, recover from helper exit, and compare canonical meaning through two host-neutral shell identities.

This is not a claim of target integration. No release was published, no deployment occurred, and nothing was merged.

## Causal commits

| SHA | Purpose | Fresh evidence |
|---|---|---|
| `11078d9` | Repository foundation and execution boundary | Repository check passed |
| `236c0e1` | Canonical package, schema, identity and supervised Rust core | Core public-seam tests passed |
| `51d164c` | Protocol casing, cancellation and 512 MiB resource ceiling | Rust format, clippy and 9 tests passed |
| `d6c6110` | Shared editorial workspace and hardened Linux shell | TypeScript, workspace/Linux tests and builds passed |
| `d7765cd` | SwiftUI/WebKit shell and Apple-Silicon package build | Swift compile exposed one type mismatch; fixed causally |
| `d2ba953` | Supervisor shutdown, UI geometry and Linux package receipt | Linux x86_64 package directory assembled |
| `f770c82` | Stale security bookmark activation repair | Swift source recompiled in CI |
| `abbb534` | Swift capability parameter compile repair | Swift tests and Apple-Silicon package build passed |
| `c10b693` | Cross-page virtual focus and stale refresh repair | 100,000-Asset window remained bounded; 5 workspace tests passed |
| `621cd41` | Explicit opaque thumbnail/preview failure states | Full five-job CI passed |
| `d158534` | Immutable-SHA pinning for every third-party CI action | Subsequent five-job CI passed |
| `c9db562` | Complete Linux release metadata | pacman/AppImage/tar assembled in compatible Linux environment |
| `2472966` | Spec and Standards reviews | No blocking source-level deviation; target gates kept open |

## Public seams

| Seam | Behavior exercised | Result |
|---|---|---|
| `LibrarySession.create/open/close` | Atomic package/manifest, one writer, future-schema rejection, close/reopen | Pass |
| `LibrarySession.addRoot/subscribe` | Progressive common-still discovery, batch events, cancellation and terminal job state | Pass |
| `LibrarySession.queryAssets` | Deterministic paging, stable tie-breaks and 100,000-Asset bounded response | Pass |
| `LibrarySession.authorizeResource` | Valid opaque session/Asset/profile; raw path, closed session, unsupported and oversized denial | Pass |
| `WorkspaceBridge.chooseRoot/revealLocation/queryCapability` | Fixed named contract; opaque IDs; no generic path, filesystem, SQL, process or IPC power | Source pass |
| `CoreSupervisor.start/restart/stop` | Version hello, forced exit, no false completion, restart and clean shutdown | Pass |
| `CanonicalDump.generate` | Electron-labelled create → Swift-labelled reopen | Zero semantic diff |

## Commands and measurements

```text
python3 scripts/check_repository.py
  pass: 10 required files; no forbidden corpus

cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
  pass: 9 tests; includes package locking, generated identity, missing state,
  100,000-Asset paging, oversized resource denial and forced helper restart

node scripts/t01-semantic-roundtrip.mjs --core target/debug/reference-core
  pass: 3 Assets; stable Library ID; semanticDiffCount 0

npm run check
  pass: TypeScript; 5 workspace tests; 6 Linux tests; workspace and shell builds

npm audit --audit-level=high
  pass: 0 known vulnerabilities

python3 scripts/generate_dependency_licenses.py
  pass: deterministic inventory for 473 Cargo/npm packages

npm run package:dir -w @pitchdog/reference-linux
  pass: Linux x86_64 package directory contains executable, ASAR and release core

cargo build --release --locked -p reference-core
npm run package -w @pitchdog/reference-linux
  first pass: AppImage and tar assembled; pacman exposed missing release metadata
  second pass: metadata fixed; pacman exposed missing runner command bsdtar (exit 127)

apt-get update && apt-get install -y --no-install-recommends libarchive-tools
  blocked: managed runner cannot change apt identities (exit 100); repository unchanged

curl -fsSL --max-time 60 https://archive.ubuntu.com/ubuntu/pool/universe/liba/libarchive/libarchive-tools_3.7.2-2ubuntu0.8_amd64.deb
sha256sum -c
  pass: Canonical package matched ca4f763c2b35a49b9d37a19cd0d3b6625c04c0b81fb4986dd3b95a6ed9de1b77

PATH=<verified-bsdtar>:$PATH npx electron-builder --linux pacman
  pass: pacman package assembled

bsdtar -tf release/linux/reference-library-0.1.0-x64.pacman
tar -tzf release/linux/reference-library-0.1.0-x64.tar.gz
  pass: archives contain packaged workspace and release core

release/linux/reference-library-0.1.0-x86_64.AppImage --appimage-extract-and-run --version
  structural extraction passed; graphical launch stopped at absent X server/DBus
```

GitHub Actions run [`33020944489`](https://github.com/bomkino/reference-library/actions/runs/33020944489) passed all five jobs at reviewed implementation head `c9db562`. On `macos-26` arm64, two Swift bridge tests passed, the release Swift executable and `aarch64-apple-darwin` Rust core compiled, ad-hoc codesign verification passed, and the app ZIP checksum verified.

## Build truth

| Target | Honest status | Verified artifact or behavior | Remaining gate |
|---|---|---|---|
| Canonical Rust core | Source-ready; production candidate | Release build, SQLite/WAL public seams, supervised crash/restart | C1 |
| Shared workspace | Source-ready | Bounded contact sheet, focus, explicit states, independent scales | M1/L1 assistive-tech and compositor checks |
| Electron/Linux | Packaged in a compatible Linux x86_64 environment | pacman `1a9af203…`, AppImage `989b25f2…`, tar `540465bf…`; each contains workspace and release core | L1 |
| Swift/macOS | Compiled and packaged on Apple-Silicon CI | Ad-hoc-signed `.app` ZIP with verified checksum | M1 |
| Cross-platform semantics | Host-neutral pass | Electron-labelled create → Swift-labelled reopen, zero semantic diff | X1 |

## Security and source-safety evidence

- Renderer receives only a frozen named bridge and opaque IDs.
- Electron uses sandboxing, context isolation, disabled Node integration, fixed IPC names, restrictive CSP and custom local protocols.
- WebKit accepts only main-frame messages from `pitchdog-ui://app`; external navigation is denied.
- Raw paths, wrong/closed sessions, unknown profiles, changed sources and resources above 512 MiB fail before renderer delivery.
- Native paths remain inside privileged core-to-shell descriptors for custom resource handling and native reveal.
- Source mutation is explicitly absent; scan preserves originals and models missing files as state.
- Helper exit rejects pending work, freezes shell writes, preserves committed metadata and requires explicit restart.
- Canonical dumps exclude grants, caches, provider paths, window state and volatile timestamps.

## Spec review

The review in `T01_SPEC_REVIEW.md` found every bounded T01 source requirement satisfied. It retained the accepted WKWebView fallback and recorded only target/release limitations: real bookmark/Finder/VoiceOver behavior, Garuda/KDE integration, real Mac–Garuda–Mac parity, target resource backpressure, signing/notarization, release checksum substitution and final iconography. Deferred features remained absent.

## Standards review

The review in `T01_STANDARDS_REVIEW.md` found no Critical or High source-level defect. Rust format/clippy/tests, TypeScript and shell tests/builds, audits, licence inventory, dependency duplication check, bridge security, accessibility semantics, recovery and compatible package assembly passed. The default placeholder icon and unperformed target assistive-tech/signing journeys remain explicit limitations.

## Honest limits

- **Verified complete:** package/schema/identity core seam, framed commands/events/cancellation/restart, bounded queries and virtualization, opaque authorization/reveal, host-neutral zero semantic diff.
- **Source-ready:** shared workspace, Electron shell, SwiftUI/WebKit shell and packaging source.
- **Packaged in compatible environments:** Linux x86_64 pacman/AppImage/tar; Apple-Silicon CI `.app.zip`.
- **Target-machine blocked:** M1, L1, X1 and therefore C1/ADR acceptance.
- **Not attempted because outside T01:** source mutation, Excerpts, similarity, duplicate review, broad formats, MCP, accounts, telemetry, AI and release publishing.
- **Known packaging limitation:** placeholder app icon; Apple package is ad-hoc signed and not notarized.

## Remaining gates only

### M1 — Apple-Silicon target integration

Launch the exact packaged app on representative Apple Silicon; exercise create/open, folder panel and bookmark lifecycle, opaque WebKit resource, Finder reveal, helper recovery, VoiceOver, Interface Scale and clean-account ZIP launch.

### L1 — Jenai's Garuda target integration

Install and run on Jenai's Garuda/Arch/KDE system; exercise pacman package, Wayland, X11 smoke, folder dialog, custom protocol, Dolphin reveal, packaged paths, fractional scaling, helper recovery, AppImage and tar fallback.

### X1 — Real cross-target semantic round-trip

Run Mac → Garuda → Mac with the exact installed builds and compare canonical dumps after excluding grants, cache and expected timestamps.

### C1 — Production Rust deployment arena

Close ADR-004 only after M1 and L1 prove the supervised Rust executable's signing, bundling, WAL recovery and resource backpressure on the real targets.

## Next exact vertical slice

Run M1 on a representative Apple-Silicon Mac using the exact CI package recipe: clean-account ZIP extraction; create/open one Library; authorize one still Root; verify bookmark restore, progressive Contact Sheet, opaque Preview, Finder reveal, Interface Scale, keyboard/VoiceOver, forced core restart and canonical dump. Pass requires no raw path exposure, no curation loss, valid signing/bundle paths and an appended target receipt. Do not begin T02 before M1/L1/X1/C1 are resolved or explicitly rescheduled.
