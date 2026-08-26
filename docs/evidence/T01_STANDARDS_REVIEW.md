# T01 Standards Review

**Review date:** 26 August 2026 UTC  
**Reviewed source:** `c9db5624cadc4894c8dd34b27d52007a65321dd0`

## Verdict

No Critical or High source-level standards defect was found in the T01 boundary. The source is ready for target integration testing. Target behavior, signing/notarization and final visual identity are deliberately not certified here.

## Ownership and module depth

- `reference-core` owns Library locking, schema, domain state, discovery, resource authorization, recovery and canonical dump.
- `reference-protocol` owns the framed public vocabulary and bounds.
- `bridge-contract` owns named workspace authority; the workspace has no transport or native implementation knowledge.
- Each shell owns process supervision, dialogs, grants, opaque byte delivery and reveal.
- The workspace owns the one visible editorial surface, paging, virtualization, focus and honest states.

Consequential seams were designed twice where evidence found a fault: restart returns a replacement session; logical selection is separate from loaded pages; native paths are privileged descriptors rather than renderer data.

## Engineering checks

| Area | Fresh check | Result |
|---|---|---|
| Rust formatting/lints | `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets -- -D warnings` | Pass |
| Rust public seams | `cargo test --workspace` | 9 pass |
| TypeScript/workspace/Linux | `npm run check` | Typecheck; 5 workspace and 6 Linux tests; builds pass |
| Dependency advisories | `npm audit --audit-level=high`; `npm audit --omit=dev` | 0 vulnerabilities |
| Dependency provenance | deterministic Cargo/npm inventory | 473 packages; 0 missing licence fields |
| Dependency duplication | `cargo tree --workspace --duplicates` | Nothing to print |
| Repository boundary | `python3 scripts/check_repository.py` | Pass; no proof corpus or legacy browser |
| Cross-host meaning | production core semantic harness | 3 Assets; stable Library ID; diff 0 |
| CI supply chain | workflow inspection | Third-party actions pinned to observed full commit SHAs; read-only contents permission |

## Security and privacy

- Electron: sandbox and context isolation on; Node and insecure content off; remote windows denied; fixed origin and IPC vocabulary; restrictive CSP; no `file://` application content.
- WebKit: non-persistent data store; fixed bundled schemes; main-frame origin check; external navigation/window creation denied.
- Resource handlers validate grammar, UUIDs, session, Asset, profile, current source length and a 512 MiB ceiling. Paths never enter workspace URLs or bridge results.
- SQL is parameterized; schema changes are sequential; a second writer and future schema are rejected without destructive repair.
- The supervised core receives a reduced environment. Crash tests reject pending work, preserve committed metadata and require an explicit restart.
- Source mutation, network features, analytics, crash upload, AI/model access and arbitrary filesystem/shell/SQL/process/IPC powers are absent.

## Accessibility and interface standards

- Grid/row/column semantics, roving logical focus, live selection announcement and visible focus are present.
- Interface Scale is tokenized and independent of thumbnail density.
- Missing/loading/error/restart states use text, not color alone; stable inspector/sidebar geometry prevents selection-driven jumps.
- Reduced Motion disables incidental motion; the Contact Sheet is static at rest.
- VoiceOver, Orca, macOS keyboard routing, KDE fractional scaling and real compositor focus remain M1/L1 measurements.

## Failure and recovery

- Atomic staging prevents half-created Library packages.
- WAL, one-writer locking, quick integrity check and interrupted-job recovery have source tests.
- Progressive discovery commits batches and checks cancellation within large directories.
- Missing source stays catalogued; resource failure never claims the original changed or deletes metadata.
- Restart replaces the session ID and reopens the same package before writes resume.

## Packaging standards

- Apple-Silicon CI compiled both Swift and Rust, built the release app, applied hardened-runtime ad-hoc signatures, verified codesign and checked the `.app.zip` hash.
- Compatible Linux x86_64 assembled pacman, AppImage and tar packages; archive listings contain the ASAR and release core.
- The package still uses the default placeholder application icon. Developer ID/notarization, Arch installation and final signing are target/release gates, not source-ready claims.

## Complexity rejected

No test farm, coverage target, plugin framework, broad media pipeline, source-operation engine, AI layer, updater or abstraction for deferred formats was introduced. Tests remain at package, protocol, bridge, renderer-authority, virtualization, restart and semantic-dump seams.
