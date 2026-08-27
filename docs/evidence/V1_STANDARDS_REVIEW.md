# V1 Standards Review

## Review identity and result

```text
Reviewed implementation SHA: b40241793fafa7d1d4e35851c9cf38673f7e1093
Reviewed implementation tree: 796c4063148861723555eafc1712d28895253c13
Branch: codex/reference-library-v1-completion
Reviewed: 27 August 2026 UTC
```

No Critical or High source-level standards defect was found.

## Identity and persistence

Generated Library, Root, Source, SourceRevision, Location, AssetOrigin, Asset and Collection identities remain independent of path, filename, scan order and fingerprint. Strict external-rename reconciliation refuses copy/hash-based identity manufacture. Moved-Root and cross-host proofs preserve domain IDs. Canonical pages exclude grants, absolute paths, platform file IDs, caches, jobs, availability observations and view preferences.

Sequential migrations are one-writer transactions. Public tests prove ID-preserving migration, rollback after deterministic faults at both V1 boundaries, exact migration-ledger verification, future-schema refusal, preserved corrupt input, manifest/database convergence, WAL recovery and two supervised curation/Collection crash cycles.

## Renderer authority, security and privacy

Both hosts expose fixed named bridges with origin and exact-shape validation. Electron uses sandboxing, context isolation and web security with Node disabled; navigation, downloads and permissions are denied. WebKit uses a nonpersistent data store. Renderer requests contain session/Asset/Location/Root/Collection IDs rather than filesystem paths, SQL, shell, process or generic IPC authority.

Opaque resources are opened and verified in privileged code, streamed in bounded chunks, capped by registries, and cancelled/drained before close, replacement, recovery or shutdown. Root grants and paths remain host-local. Typed errors and restart events are path-free. No account, telemetry, analytics/crash upload, remote privileged content, cloud dependency, embedded model or updater path exists.

## Accessibility and interaction

Source tests cover semantic grid/row/column roles, one deterministic roving tab stop, visible fallback focus, keyboard-only daily-use commands, trapped/fallback dialog focus, named and pressed/selected controls, polite progress and assertive error announcements without card-count verbosity. Interface Scale, grid density and Preview zoom remain independent. VoiceOver, Orca, Finder/KDE routing, fractional scaling and compositor behavior are honestly deferred to M1/L1.

## Performance and boundedness

- Control frames: 1 MiB maximum; request IDs and output records are bounded.
- Assets/canonical proof: byte-bounded pages, snapshot pinning, stable tie-breaks and no whole-document V1 serialization.
- Serious Library: generated 100,000-Asset proof; workspace renders at most 66 cards in the acceptance fixture.
- Scanner: bounded directory/global counts, queue, batches, events and terminal job retention.
- Renditions: two workers, ten Core work items, 512 MiB source, 256 MiB decode allocation, 64-megapixel input, 512-pixel grid edge and 8 MiB output.
- Resource delivery: 64 KiB streaming with bounded native leases and session-generation revocation.
- Non-cooperative decode: the supervised process timeout kills the generation, fails every pending request, freezes writes and preserves canonical Library meaning across restart.

## Packaging and provenance

Locked Cargo/npm graphs, pinned GitHub Actions, deterministic icon/release metadata, safe archive preflight, extracted-package validation, legal payload checks, exact-source checksums and build receipts are present. The shipped legal closure contains 74 locked packages. Full and production npm audits report zero vulnerabilities. RustSec `cargo-audit` is pinned at 0.22.2 in exact-head CI so the final receipt does not rely only on npm advisory evidence.

Compatible CI assembles and exercises Linux packages under X11 and headless Wayland and compiles/packages the Apple arm64 app with structural, architecture, entitlement and ad-hoc signature checks. Those measurements support `packaged in compatible environments`, not `integrated on Garuda` or `integrated on Apple Silicon`.

## Residual limitations

- The image decoder call is synchronous and cannot be preempted inside third-party code; the supervised Core process is the hard containment boundary. Target cancellation, memory and packaged lifecycle behavior remain C1.
- Apple packaging is ad-hoc signed in CI; Developer ID, notarization, Gatekeeper and clean-account launch remain M1/release work.
- Compatible Ubuntu is not representative Garuda/KDE; target dialogs, Dolphin, Orca, fractional scaling and filesystem behavior remain L1.
- CI warnings originating from pinned upstream JavaScript Actions or transitive development packages are not shipped-product defects; vulnerability audits remain authoritative.

## Finding

The source implementation meets the V1 standards bar. Final eligibility requires the review/receipt head to pass exact-source CI. M1, L1, X1, C1 and explicit public-release authority remain open.

