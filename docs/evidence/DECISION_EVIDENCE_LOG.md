# Append-Only Decision and Evidence Log

Do not rewrite or delete entries. Corrections append a superseding entry.

## 2026-08-26 — Repository truth

**Hypothesis:** remote `main` still matches execution contract.  
**Change:** none.  
**Fresh measurement:** GitHub connector and local fetch both resolved `main` to `622237237e4492292df91b8912f9109cb3a0bf1e`; clean tree contains only `LICENSE` and `README.md`.  
**Decision:** keep expected baseline; create isolated tracer branch. No reconciliation required.

## 2026-08-26 — Handover integrity

**Hypothesis:** uploaded package is complete and internally consistent.  
**Change:** extracted into non-repository scratch space only.  
**Fresh measurement:** all 671 entries passed `sha256sum -c PACKAGE_MANIFEST.sha256`.  
**Decision:** use package as binding execution contract; never commit full proof corpus.

## 2026-08-26 — Durable repository foundation

**Hypothesis:** a concise repository-owned constitution, glossary, tracer contract, ADR set, security model, provenance policy and boundary check can preserve the contract without importing the proof corpus.  
**Change:** materialized those documents plus the smallest CI job and root structure.  
**Fresh measurement:** `python3 scripts/check_repository.py`, JSON parsing and `git diff --check` passed; check found all 10 required files and no forbidden proof/legacy directories.  
**Decision:** keep foundation and commit as first causal increment.

## 2026-08-26 — T01 package, identity and supervised core slice

**Hypothesis:** one production Rust process can own a package-directory Library, SQLite model, progressive common-still discovery, bounded queries, opaque-resource authorization and canonical dump while surviving supervised restart.
**Change:** added framed protocol crate, migration 1, atomic package create/open/close, writer lock, Source/Revision/Location and AssetOrigin/Asset persistence, cancellable progressive scanner, resource/reveal resolution, canonical dump, dependency inventory and public-seam fixtures.
**Fresh measurement:** `cargo test --workspace` passed 7 tests, including 100,000-Asset paging in 13.97 seconds and forced core exit/restart in 0.18 seconds; `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`, licence generation, repository boundary check and `git diff --check` passed.
**Decision:** keep production-candidate supervised protocol as ADR-004 Proposed; commit slice. C1/M1/L1 remain required before acceptance/integration.

## 2026-08-26 — T01 protocol and resource boundary hardening

**Hypothesis:** camel-case field serialization, per-entry cancellation checks and a bounded native resource descriptor close interoperability and backpressure gaps without widening the public seam.
**Change:** made the framed JSON shape explicit, checked cancellation inside large directories, and denied still resources larger than 512 MiB before either shell reads bytes.
**Fresh measurement:** `cargo test --workspace` passed 9 public-seam and unit tests, including a sparse 512 MiB resource denial; `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all -- --check` passed.
**Decision:** keep the narrow interoperable protocol and 512 MiB T01 resource ceiling; target-machine range/backpressure proof remains in M1/L1.

## 2026-08-26 — Shared workspace and Garuda shell source

**Hypothesis:** a single bounded React contact sheet can remain platform-neutral while a sandboxed Electron shell owns every privileged Linux operation.
**Change:** added the versioned named bridge, editorial workspace, paging and virtualization, stable keyboard selection, independent Interface Scale and thumbnail density, opaque preview resources, native reveal, supervised Electron main/preload, and pacman/AppImage/tar source configuration.
**Fresh measurement:** `npm run check` passed TypeScript, 4 workspace tests, 6 Linux public-seam tests and both production builds; `npm audit --audit-level=high` found 0 vulnerabilities; `electron-builder --dir` assembled a Linux x86_64 package directory containing a 2.1 MiB ASAR and the 3.5 MiB release core.
**Decision:** keep the shared workspace and hardened Linux shell. Status is packaged in a compatible Linux x86_64 environment, not integrated on Garuda; L1 remains open.

## 2026-08-26 — Virtual focus and refresh hardening

**Hypothesis:** logical keyboard focus can cross an unloaded page without expanding the rendered window or losing selection during progressive refresh.
**Change:** retained a pending logical focus index, scrolled it into the bounded window, selected after its page arrived, isolated stale page completions by generation, and mapped closed opaque-resource sessions through the typed core error code.
**Fresh measurement:** `npm run check` passed TypeScript, 5 workspace tests, 6 Linux public-seam tests and both production builds; the 100,000-Asset fixture remains bounded to at most 66 rendered cards.
**Decision:** keep the focus/refresh repair; target assistive-technology and compositor behavior remains in M1/L1.

## 2026-08-26 — T01 source-ready receipt

**Hypothesis:** the bounded T01 journey can be called source-ready once every available public seam, both shell source builds and compatible package assemblies pass from the synchronized branch, while target integration remains unclaimed.
**Change:** closed the visible Library, virtual-focus and opaque-resource failure seams; compiled the SwiftUI/WebKit adapter; assembled Linux and Apple-Silicon packages; recorded the final source receipt.
**Fresh measurement:** source head `621cd4192b6073ffbb0f93a26112c2c8e162da0c` passed all five jobs in GitHub Actions run `33020077063`: repository boundary, Rust format/clippy/9 tests plus zero-diff semantic round-trip, TypeScript/5 workspace tests/6 Linux tests/build/licence audit, Linux x86_64 package directory, and Apple-Silicon Swift tests/ad-hoc codesign/app ZIP checksum. Local rerun matched those non-Swift seams.
**Decision:** mark T01 source-ready, not target-integrated. Only M1, L1, X1 and C1 remain; do not dispatch T02 from this branch.

## 2026-08-26 — Honest resource failure states

**Hypothesis:** opaque resource failures can remain explicit without revealing paths or destabilizing contact-sheet geometry.
**Change:** added per-card loading/unavailable states and a bounded Preview error surface that confirms the original remains untouched.
**Fresh measurement:** `npm run check` again passed TypeScript, 5 workspace tests, 6 Linux public-seam tests and production workspace/Linux builds.
**Decision:** keep the local failure states; decoder- and target-specific behavior remains in M1/L1.

## 2026-08-26 — Linux distributable package assembly

**Hypothesis:** the declared pacman/AppImage/tar targets can assemble in the compatible Linux runner once release metadata and the Arch mtree tool are explicit.
**Change:** added repository homepage, verified repository-author address and desktop identity; supplied `bsdtar` from Canonical's `libarchive-tools_3.7.2-2ubuntu0.8_amd64.deb` after verifying SHA-256 `ca4f763c2b35a49b9d37a19cd0d3b6625c04c0b81fb4986dd3b95a6ed9de1b77`.
**Fresh measurement:** pacman, AppImage and tar packages assembled and listed successfully. SHA-256 values are `1a9af20340b23c72e7c401086db4ae693cf9d1989527c3d7cb2e19cc29aa3447`, `989b25f29480fca3fe7eee9a4b35b1c782ae7e82f06620b7b27e3cdc7cd4e898` and `540465bfd1168a3fbc573db779b436311c85f373f6be523fd395b4f533bcaad8` respectively. AppImage extraction passed; graphical launch stopped at the runner's absent X server/DBus.
**Decision:** status is packaged in a compatible Linux x86_64 environment, not integrated on Garuda. Keep L1 open and record the default placeholder icon as a packaging-polish limitation.

## 2026-08-27 — Bounded resource delivery and exact target artifacts

**Hypothesis:** the remaining cloud environment can reduce C1/M1/L1 risk by bounding privileged resource delivery and retaining source-bound target packages without claiming target integration.
**Change:** replaced whole-file opaque resource responses with cancellable 64 KiB streams in both privileged shells; added exact-file SHA-256 receipts with explicit install/integration/release exclusions; made CI assemble and retain the full pacman/AppImage/tar and Apple-Silicon `.app.zip` bundles for 30 days.
**Fresh measurement:** local Rust and Node source gates passed, including 2 receipt tests, 5 workspace tests and 8 Linux tests; compatible Linux packaging rebuilt all three archives and verified their contents. GitHub Actions run `33036147773` passed all five jobs at source `d252121d1cca9022f679212d0f8c198fa04d20d3`; Swift tests compiled the cancellable WebKit handler, both package receipts verified on their matching CI architectures, and artifacts `9632141919` (Linux) and `9632095326` (macOS) uploaded with SHA-256 container digests.
**Decision:** keep the hardening and source-bound artifacts. Resource backpressure is now implemented and source-tested, but C1 remains open until cancellation, memory behavior, WAL recovery, signing and bundling pass on the real targets. M1, L1 and X1 remain open.

## 2026-08-27 — T02 branch and reconciliation seam

**Hypothesis:** source-only product work can continue without weakening or falsely satisfying the target-machine gates by isolating the next exact slice from the verified T01 head.
**Change:** created `codex/reference-library-t02-rename-reconciliation` from remote T01 head `858202c2bbf5f3427703ccf42414a1629d0f8a59`; designed external rename reconciliation twice around the existing Root scan and migration-1 platform-evidence fields.
**Fresh measurement:** clean checkout resolved to tree `c9c65b278a1bbbe54c9741ab8f6a85607531f752`, identical to the verified remote T01 tree; `main` remains outside this branch.
**Decision:** keep M1, L1, X1 and C1 open and explicitly rescheduled. Dispatch only T02 rename/Missing reconciliation; add no source mutation or post-T02 feature.

## 2026-08-27 — T02 external rename reconciliation

**Hypothesis:** existing migration-1 platform identity fields can preserve a pure external rename without turning paths or fingerprints into identity and without widening the public command seam.
**Change:** common-still scans now retain Unix device/inode evidence, require a unique single-link file identity plus matching current Revision and absent old path before updating the existing Location, and reactivate a Source when its original path returns. Insufficient evidence inserts a separate Source/Location/Asset and leaves the unseen original Missing.
**Fresh measurement:** `cargo test --workspace` passed 12 tests. Three new T02 public-seam fixtures proved stable Source, SourceRevision, Location, AssetOrigin and Asset IDs across rename/reopen; identical delete-plus-copy produced two equal fingerprints but distinct Assets with the original Missing; original-path restoration returned the same Source and Asset to `active`/`present`. The 100,000-Asset T01 window remained green in 7.91 seconds. Rust format, Clippy with warnings denied, repository boundary and diff checks passed.
**Decision:** keep the strict relocation predicate. Accept visible false negatives when host evidence is missing or ambiguous; never manufacture a lineage merge from path, filename, size or fingerprint.

## 2026-08-27 — T02 stable editorial selection

**Hypothesis:** the bounded contact sheet can reflect a reconciled rename or Missing transition without dropping selection, reopening renderer authority or retaining a stale inspector summary.
**Change:** loaded Asset pages now rebind selection and Preview by stable Asset ID; a Missing Preview renders an explicit unavailable state while retaining curation. The core advertises external rename reconciliation without adding a command or source-mutation capability.
**Fresh measurement:** `npm run check` passed TypeScript, 6 workspace tests, 8 Linux shell tests and both production builds. The new selection fixture kept identity while refreshing renamed and Missing summaries and preserved an unloaded selection. Existing opaque-resource and supervisor tests remained green.
**Decision:** keep ID-based summary refresh inside the workspace. Do not add a reconciliation panel or mutation control to T02.

## 2026-08-27 — T02 full local verification and reviews

**Hypothesis:** the isolated T02 delta can satisfy every available source seam and compatible package check without weakening T01 or claiming the rescheduled target gates.
**Change:** no implementation change; ran the complete repository/Rust/Node/semantic/audit/provenance matrix, assembled all Linux package formats, and performed Spec and Standards reviews against source tree `e6bfa93a528804e2498153f01bfedc2ff2f88f55`.
**Fresh measurement:** 12 Rust, 6 workspace, 8 Linux and 2 receipt tests passed; semantic diff remained zero; npm full and production audits found zero vulnerabilities; the deterministic 473-package inventory was unchanged; compatible pacman/AppImage/tar artifacts assembled and their executable/core/ASAR paths verified. The first pacman attempt exposed an absent `bsdtar` command and was rerun successfully with the previously verified compatible binary. Reviews found no Critical or High source defect and no T02 contract deviation.
**Decision:** keep the implementation unchanged. Mark it source-complete pending exact-head CI; retain M1, L1, X1 and C1 as open target evidence.

## 2026-08-27 — T02 exact-source CI and artifacts

**Hypothesis:** the locally reviewed T02 tree compiles and packages unchanged on the declared Ubuntu x86_64 and Apple-Silicon CI environments.
**Change:** no source change; synchronized the four causal commits and ran CI at review/receipt source `39c1a20f9ee1ef04af1774b69368dbe0d0ee8362`.
**Fresh measurement:** GitHub Actions run `33040429601` passed all five jobs. Linux artifact `9633709504` and macOS artifact `9633656547` are bound to the exact source and retained through 26 September 2026; their workflow-container digests are recorded in the T02 receipt.
**Decision:** mark T02 source-ready and packaged in compatible environments. Do not claim M1, L1, X1 or C1, and do not merge, release or deploy.

## 2026-08-27 — V1 daily-use execution contract

**Hypothesis:** the next product increment can remain narrow and falsifiable only if its daily-use capability, public seams, source closure and target gates are frozen before implementation begins.
**Change:** added the V1-01–V1-10 execution contract and append-only run ledger; advanced the implementation frontier from T02 to safe migrations/recovery, Root lifecycle, real bounded renditions, manual curation, lexical query, flat Collections, independent view controls, compatible Linux runtime rehearsal and bounded canonical proof. No product source, manifest, workflow or package configuration changed.
**Fresh measurement:** `python3 scripts/check_repository.py` and `git diff --check` passed from the exact clean T02 base.
**Decision:** execute one public-seam vertical slice at a time. Keep M1, L1, X1 and C1 open; prohibit post-v1 scope until source-ready closure and target integration are independently proved.

## 2026-08-27 — Bounded V1 host-neutral proof contract

**Hypothesis:** cross-host semantic evidence can remain bounded and independently testable before Core integration if diagnostic pages are explicitly bound to a digest and the harness never requests a whole-document dump.
**Change:** specified the V1 Electron → Swift → Electron host-neutral journey; added a reusable digest/page collector, standalone cursor/count/snapshot tests and an integration script that carries manual curation plus flat Collection membership across host labels. The T01 harness and Core production source remain unchanged.
**Fresh measurement:** `node --check` passed both new scripts; 3 collector tests passed; the complete baseline `npm test` passed 5 script, 6 workspace and 8 Linux tests after building the T02 Core; repository boundary and diff checks passed.
**Decision:** keep the harness ready for ordered integration after the V1 Core public seam. Host-neutral success remains source evidence only and cannot close M1, L1 or X1.

## 2026-08-27 — V1 daily-use Library source closure

**Hypothesis:** V1 is source-ready only if the exact reviewed tree proves durable identity and recovery, bounded daily-use editorial work, contained privileged hosts, real compatible-package runtime and neutral same-document meaning without converting CI into target evidence.

**Change:** closed V1-01 through V1-09 with causal implementation and adversarial public-seam proofs; added pinned RustSec auditing, warning-clean Swift compilation, Spec/Standards reviews and an exact-source receipt. Preserved every constitutional prohibition and deferred feature boundary.

**Fresh measurement:** local Rust 81, script 24, workspace 26 and Linux 55 tests passed; npm audits found zero vulnerabilities; semantic diff was zero. GitHub Actions run `33080333170` passed repository, Rust/RustSec, workspace/Linux source, Apple arm64 package and complete Linux package/runtime jobs at tree `5afd2d576e6d7f1a0df6c7ff369f36c8d91951a2`. Artifact IDs and SHA-256 container digests are recorded in `V1_SOURCE_READY_RECEIPT.md`.

**Decision:** keep the source and compatible-runner result. Source-ready is not installed integration: M1, L1, X1 and C1 remain open, ADR-004/ADR-006 remain Proposed, and release publication still requires explicit authority.


## 2026-08-27 — Superseding Wayland proof-harness closure

**Hypothesis:** the receipt-head Wayland failure was caused by the zero-delay renderer-close proof racing its own DevTools acknowledgement, not by a packaged application crash.

**Change:** delayed `window.close()` by 250 ms after an awaited DevTools command and added a public regression seam that rejects the previous zero-delay expression. No product source, sandbox setting, package payload or claim boundary changed.

**Fresh measurement:** focused and complete JavaScript seams passed locally. GitHub Actions run `33082121964` passed all five jobs at source tree `01835315338858e0ad73ade01e6a99f5d658299c`; the exact extracted pacman application completed its workspace/Core journey under both X11 and a real headless Wayland compositor, acknowledged close and exited cleanly. Exact-source Apple arm64 artifact `9650628469` and Linux x86_64 artifact `9650719750`, with their workflow-container digests, are recorded in `V1_SOURCE_READY_RECEIPT.md`.

**Decision:** keep the fix and use run `33082121964` as the reviewed implementation evidence. Do not reinterpret compatible Ubuntu or Apple-Silicon CI as M1/L1/X1/C1 integration.
