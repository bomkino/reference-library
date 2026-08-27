# T01 Spec Review

**Review date:** 26 August 2026 UTC  
**Reviewed source:** `c9db5624cadc4894c8dd34b27d52007a65321dd0`  
**Contract:** product constitution, full Reference Library specification, accepted/proposed ADRs, T01 tracer, security boundary and target gates from the verified handover package.

## Verdict

T01 satisfies the cloud/source-ready contract. It does not satisfy M1, L1, X1 or C1, so no target-integration, cross-platform-integration or release claim is permitted.

## Satisfied requirements

| Requirement | Implementation evidence | Review finding |
|---|---|---|
| Reference Library only | Constitution, migration 1, core and two shells contain no Deck Workbench or Font Lab surface | Satisfied |
| One project, one Library | Atomic `.pitchlibrary` package with manifest, SQLite canonical state and one-writer lock | Satisfied for T01 |
| Canonical identity model | Source → SourceRevision → Location and AssetOrigin(kind Whole) → Asset persisted separately | Satisfied |
| Path-independent Asset identity | Generated UUIDs; rewrite/reopen/missing fixtures preserve Asset identity | Satisfied |
| Production-candidate core protocol | 1 MiB versioned frames, typed commands/results/events, 250-item page cap, cancellation, restart and canonical dump | Satisfied at source seam |
| One explicit Root | Native folder command; symlinks skipped; JPEG/PNG/WebP discovered in 32-item batches | Satisfied |
| Editorial resting surface | Shared Contact Sheet, stable sidebar/inspector geometry, no dashboard or ambient autoplay | Satisfied |
| Bounded workspace | 100,000-Asset fixture renders no more than 66 cards; 100-item bridge pages | Satisfied |
| Scale independence | Interface Scale 80/100/125/150%; separate thumbnail-density control | Satisfied |
| Honest states | Library/query/loading/empty/missing/core-restart/resource-failure states are explicit | Satisfied |
| Opaque Preview and native reveal | Session/Asset/profile URL; privileged path remains core-to-shell; reveal accepts Location ID | Satisfied |
| Garuda shell source | Sandboxed Electron renderer, frozen preload, fixed IPC, pacman/AppImage/tar configuration and built packages | Source-ready; L1 open |
| Apple-Silicon shell source | SwiftUI/WKWebView fallback, origin-checked bridge, bookmark store, Finder reveal and `.app.zip` script | Compiled/packaged in compatible CI; M1 open |
| Shared document meaning | Electron-labelled create → Swift-labelled reopen produced zero canonical semantic diff | Host-neutral pass; X1 open |

## Deviations and limitations

- The macOS shell uses the specification's accepted `WKWebView`/`NSViewRepresentable` fallback, not macOS 26's newer first-party SwiftUI WebKit surface.
- Apple packaging is ad-hoc signed in CI. Developer ID signing, notarization, clean-account launch, real security-scoped bookmark lifecycle, Finder and VoiceOver remain M1.
- Linux packages were assembled on compatible Ubuntu x86_64. pacman install, KDE portal/dialog behavior, Wayland/X11, Dolphin reveal, fractional scaling and Orca remain L1.
- The semantic round-trip uses two named host-neutral clients around the production core. It is not the Mac → Garuda → Mac X1 journey.
- T01 reads an authorized still resource as one bounded response with a 512 MiB ceiling. Range/backpressure behavior remains a target gate.
- Release-time PKGBUILD tarball checksum substitution, a product-specific icon, signing and final release metadata remain packaging polish; no release was created.

No deviation changes canonical document meaning or widens workspace authority.

## Deferred non-goals check

No source move/copy/Trash, similarity, duplicate review, Excerpt authoring, broad format coverage, MCP, AI/model feature, account, telemetry, cloud sync, updater or release publishing was added.

## Review repairs retained

- Core restart now returns the replacement session instead of leaving the workspace with a dead ID.
- Virtual focus waits for unloaded pages and stale page completions cannot overwrite a newer generation.
- Opaque-resource failures now have explicit bounded UI states.
- CI actions are immutable-SHA pinned; Linux package metadata is complete.

## Next gate

Run M1 and L1 with the exact packages, then X1. Keep ADR-004 and ADR-006 Proposed until those measurements exist.

## 27 August 2026 follow-up hardening review

**Reviewed source:** `d252121d1cca9022f679212d0f8c198fa04d20d3`

- Both privileged opaque-resource handlers now deliver authorised stills in cancellable 64 KiB chunks after an exact regular-file length preflight. The renderer contract and 512 MiB ceiling did not change.
- CI now builds the complete Linux pacman/AppImage/tar set and Apple-Silicon `.app.zip`, creates SHA-256 receipts bound to the full source commit, verifies each receipt on the matching runner architecture, and retains both bundles as workflow artifacts.
- Receipt vocabulary explicitly excludes `installed`, `target_integrated` and `released`; artifact upload is not treated as a release.
- No T02 capability, new renderer authority, format expansion, source mutation, AI, account, telemetry or cloud product dependency was added.

**Finding:** no new T01 deviation. The source-level backpressure gap is reduced; real WebKit/Electron cancellation and memory behavior remain C1 measurements inside M1/L1.
