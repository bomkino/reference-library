# V1 — Daily-Use Still-Image Library

## Authority and status

This is the binding execution ledger for the first daily-use Reference Library release candidate. Work starts from exact T02 source-ready commit `8afdfa1f84b5421f3423f6d0df6c07b48229f944` (tree `e2bc259dad72823db174efd065d272d368e9ee71`) on isolated branch `codex/reference-library-v1-completion`.

The contract authorizes safe, reversible source work, causal commits, branch synchronization and CI on that branch. It does not authorize a merge, deployment, public release, force-push or repository-settings change. Source and compatible-runner evidence must never be reported as Apple-Silicon or Garuda integration.

## User capability

A person can create or reopen one project Library, see and reconnect its authorized Roots, progressively discover common still images, and use a calm bounded Contact Sheet to search, filter, review and organize stable Assets. They can give an Asset a title and note, place it in flat Collections, inspect a real bounded rendition, zoom Preview independently of the interface and grid, reveal the original, rescan or cancel work, and carry the same canonical Library between the Mac and Linux editions without losing meaning.

The product remains fully local, account-free, telemetry-free, model-free and manual. Originals stay in place. Paths, names, bytes, hashes and scan order remain evidence, never Asset identity.

## Frozen completion ledger

Every item below is required for v1. An item is complete only when its named public seams and causal acceptance checks pass freshly; file existence or compilation alone is not evidence.

### V1-01 — Safe schema evolution and recovery

Add the smallest sequential migration needed for durable editorial notes and flat Collections. Preserve generated IDs and every T01/T02 row. A migration runs under the one-writer lock and is all-or-nothing across a crash or injected failure. Manifest and database schema never disagree silently; future schema is rejected without downgrade; corrupt input is preserved rather than repaired destructively.

Public seams:

```text
LibrarySession.open
LibrarySession.close
CoreSupervisor.restart
```

Causal acceptance:

- a migration-1 fixture opens as the new schema with identical Library, Root, Source, SourceRevision, Location, Asset and AssetOrigin IDs;
- failure at each measured migration boundary leaves either the old consistent schema or the new consistent schema, never a partial migration;
- committed curation survives helper termination, WAL recovery, close/reopen and a second recovery cycle;
- an integrity failure is an explicit read-only/preserved error state and never deletes or overwrites the Library;
- derived caches and permission grants remain outside canonical document meaning.

### V1-02 — Root inventory, reconnect, rescan and cancellation

The workspace lists each authorized Root by stable Root ID, user-facing name and honest availability or scan state. The native shell can reconnect an existing Root to a newly granted host folder without creating a replacement Root. Rescan targets a Root ID. Long discovery and rendition work emits bounded progress and supports idempotent cancellation.

Public seams:

```text
LibrarySession.queryRoots
LibrarySession.reauthorizeRoot(rootId)
LibrarySession.rescanRoot(rootId)
LibrarySession.queryJobs
LibrarySession.cancelJob(jobId)
WorkspaceBridge.chooseRoot
```

Causal acceptance:

- reconnect keeps the Root ID and all matching Source, Location, AssetOrigin and Asset IDs;
- reauthorizing the same Root never duplicates the Root or its Assets merely because the absolute provider path changed;
- wrong-session, unknown-Root and raw-path attempts fail with typed path-free errors;
- a cancelled scan reaches one terminal cancelled state, commits no false completion and can be restarted;
- unplugged, unreadable and Missing states remain distinguishable where the host supplies enough evidence;
- the renderer sees names, relative display paths and opaque IDs, never grants or absolute provider paths.

Removing a Root or deleting its Assets is not part of v1.

### V1-03 — Real bounded renditions

Contact-sheet cards use actual decoded, orientation-corrected where safely available, downsampled renditions rather than the original file mislabeled as `grid_standard`. Renditions are disposable, provider-versioned cache entries outside the neutral Library. Common JPEG, PNG and WebP sources use the safe provider; decoder or format failure remains an explicit catalogue-only state.

Public seams:

```text
LibrarySession.authorizeResource(assetId, profile=gridStandard)
LibrarySession.authorizeResource(assetId, profile=preview)
LibrarySession.cancelJob(jobId)
```

Causal acceptance:

- `gridStandard` output has a bounded pixel envelope and byte ceiling, retains aspect ratio and is not the original source path or byte stream;
- repeated authorization reuses a valid provider/version/source-revision cache entry;
- changed SourceRevision, provider version or failed verification invalidates the cache without changing Asset identity;
- corrupt, oversized, unsupported and decompression-hostile input fails closed without entering the workspace DOM or hiding the Asset;
- generation is cancellable and bounded in concurrent work and memory;
- Preview remains opaque and streamed with backpressure; the workspace never receives an absolute path.

Exact rendition dimensions, encoding and provider version are implementation constants covered by public-seam tests, not canonical meaning.

### V1-04 — Durable manual curation

An Asset has one manual review state—`unreviewed`, `keep`, `maybe` or `reject`—plus an optional custom title and plain-text editorial note. Commands target stable Asset IDs, validate lengths and states, commit atomically and publish the refreshed Asset summary. No curation edit mutates or renames a source file.

Public seams:

```text
LibrarySession.updateAssetReview(assetId, reviewState)
LibrarySession.updateAssetTitle(assetId, title|null)
LibrarySession.updateAssetNote(assetId, note|null)
```

Causal acceptance:

- edits survive rescan, external rename, Missing, reconnect, helper restart and close/reopen;
- empty title/note input normalizes consistently; bounded oversized input is rejected before a write;
- unknown IDs, invalid states and wrong sessions fail with typed path-free errors;
- selected-card, inspector and query results update by stable Asset ID without losing logical focus;
- curation is present in the neutral canonical projection and identical across hosts.

### V1-05 — Local lexical query and filters

The Contact Sheet provides a local lexical query over filename/relative display name, custom title and editorial note. It supports Root, review-state, availability and Collection filters plus a small explicit sort vocabulary with stable ID tie-breaks. Search is lexical only: no embeddings, model, generated tags, semantic ranking, external service or automatic creative judgment.

Public seam:

```text
LibrarySession.queryAssets(window, query, filters, sort, projection)
```

Causal acceptance:

- blank query with no filters preserves the current deterministic contact-sheet result;
- query, filter and sort combinations page deterministically with no duplicate or skipped IDs;
- curation and Collection changes appear after the next result generation without expanding renderer authority;
- punctuation, empty results and safely supported Unicode text have explicit deterministic behavior;
- the 100,000-Asset fixture remains a bounded window in core response size, DOM card count and memory use;
- loading, no-Library, empty-Library, no-results, error, unsupported and Missing states remain distinct.

### V1-06 — Flat manual Collections

Collections are stable generated identities with a trimmed user name and manual Asset membership. A person can create, rename and delete a Collection, and add or remove one or more Assets. Deleting a Collection deletes only membership and the Collection record; it never deletes Assets, Sources or original files.

Public seams:

```text
LibrarySession.queryCollections
LibrarySession.createCollection(name)
LibrarySession.renameCollection(collectionId, name)
LibrarySession.deleteCollection(collectionId)
LibrarySession.addAssetsToCollection(collectionId, assetIds)
LibrarySession.removeAssetsFromCollection(collectionId, assetIds)
```

Causal acceptance:

- Collection and membership IDs/meaning survive restart, reopen, Missing and cross-host round-trip;
- duplicate membership is idempotent and batch membership is one transaction;
- invalid names, unknown IDs, wrong sessions and bounded oversized batches fail without partial writes;
- deletion requires an explicit user action and leaves every Asset and source untouched;
- Collection membership is queryable without loading all Assets and is included in the canonical projection.

V1 Collections are flat, manual and unordered. Nesting, smart rules, sharing and manual card ordering are post-v1.

### V1-07 — Daily-use workspace and independent view controls

Editorial Contact Sheet remains the resting surface. Root inventory, local search, filter/sort, curation and Collection controls integrate without a SaaS dashboard treatment or unstable panel geometry. Interface Scale, thumbnail density and Preview zoom are independent controls. Host-local view preferences persist outside canonical Library meaning.

Causal acceptance:

- Interface Scale still offers at least 80%, 100%, 125% and 150% and does not alter grid density or Preview zoom;
- grid density changes card geometry without changing application chrome or Preview zoom;
- Preview supports fit and explicit zoom steps, preserves a stable focal point where possible, and never scales the surrounding interface;
- keyboard-only create/open, Root, query, review, Collection, selection, Preview, zoom and reveal journeys have visible focus and deterministic order;
- controls have accessible names, pressed/selected states and live progress/error announcements without card-count-dependent verbosity;
- selection remains stable by Asset ID across paging, query refresh, curation, rename, Missing and Collection edits;
- at rest there is no ambient autoplay or grid-wide motion.

### V1-08 — Honest package-open and compatible Linux runtime rehearsal

Both shells either implement their declared `.pitchlibrary` association or remove the claim. Opening a package from the OS routes through the same validated `LibrarySession.open` seam; a second open event is serialized rather than spawning an unowned writer.

Ubuntu CI must go beyond archive listing while retaining precise status language. From the exact source it must:

- build the release core and workspace from locked dependencies;
- assemble pacman, AppImage and tar artifacts;
- extract each artifact to a fresh directory, reject unsafe archive paths, and verify executable modes, ASAR, helper, desktop metadata, licence/provenance payload and version consistency;
- execute the packaged helper's framed Hello/Shutdown journey;
- launch the packaged Electron app under Xvfb through a narrow deterministic smoke journey, then terminate it cleanly;
- exercise an available headless Wayland compositor when the pinned runner supports it, otherwise record that seam as L1-only rather than silently passing it;
- generate generic source-bound checksums and a build receipt that does not retain a stale tracer name.

Compatible Ubuntu rehearsal is not Garuda integration. Pacman installation, KDE dialogs, Dolphin reveal, representative filesystem identity, fractional scaling, Wayland/X11 desktop behavior and Orca remain L1.

Apple-Silicon CI may compile and structurally inspect the `.app.zip`, helper architecture, plist association, resources, licences, checksums and signatures. Finder, bookmark lifecycle, Gatekeeper, VoiceOver and installed runtime behavior remain M1.

### V1-09 — Bounded neutral canonical proof

The canonical projection contains durable Library meaning: generated identities, Root logical identity and name, Sources/Revisions/relative Locations, whole-file Asset origins, Assets and manual curation, flat Collections and membership. It excludes permission grants, absolute provider paths, platform file IDs, caches/renditions, jobs/progress, window/view preferences, availability observations and expected volatile timestamps.

Canonical proof must remain bounded for a serious Library. A deterministic digest and bounded diagnostic pages are computed from one read snapshot using explicit record framing and stable ordering. The cross-host harness never relies on control JSON containing an entire 100,000-Asset document.

Public seams:

```text
CanonicalProjection.digest
CanonicalProjection.page(entity, cursor, limit)
```

Causal acceptance:

- identical durable meaning produces identical per-entity counts and digest across close/reopen and host-neutral reopen;
- grants, cache rebuild, Root absolute-path reconnect, job history and host availability do not change the digest;
- title, note, review state, Collection or membership changes do change it;
- pages are deterministic, bounded and sufficient to locate a digest mismatch;
- the 100,000-Asset fixture completes without exceeding framed-message limits or serializing all rows at once.

The legacy small `CanonicalDump.generate` may remain as a diagnostic compatibility seam, but v1 evidence and X1 use the bounded projection.

### V1-10 — Source-ready closure

Before claiming v1 source-ready:

- run one Spec review against every V1-01 through V1-09 acceptance clause;
- run one Standards review across identity, migrations/recovery, renderer authority, privacy, accessibility, performance, packaging and dependency provenance;
- run the repository, Rust, Node, Swift-source/CI, dependency audit, licence inventory, semantic, compatible Linux package and packaged-runtime seams freshly at the exact reviewed head;
- produce an exact-source evidence receipt with commands, results, commits, artifact hashes, limitations and honest gate status;
- synchronize the isolated branch and require exact-head CI to pass before the source-ready claim.

No target gate may be closed by this source-only item.

## Target gates required for a v1 release candidate

### M1 — Apple-Silicon integration

Install the exact source-bound `.app.zip` on representative Apple Silicon and exercise create/open/package-open, APFS discovery/rename/reconnect, security-scoped bookmark lifecycle, real renditions and opaque Preview, Finder reveal, curation/search/Collections, restart/WAL recovery, Interface Scale/Preview zoom, keyboard and VoiceOver. Record exact hardware, macOS, artifact SHA-256, signing/Gatekeeper state, commands and failures.

### L1 — Garuda integration

Install the exact source-bound package on representative Garuda/Arch/KDE and exercise pacman plus AppImage/tar fallbacks, package-open, representative filesystem discovery/rename/reconnect, real renditions and opaque protocol, KDE folder dialog, Dolphin reveal, curation/search/Collections, restart/WAL recovery, fractional scaling, keyboard and Orca under both Wayland and X11. Record exact hardware, OS/session, artifact SHA-256, commands and failures.

### X1 — Cross-platform canonical integration

Using the exact M1/L1 builds and one real Library, complete Mac → Garuda → Mac. Reauthorize the same logical Roots, change curation and Collection membership on both hosts, reconcile one external rename and one Missing/restore case, and compare bounded canonical counts/digests plus diagnostic pages. Durable meaning must return with zero unexplained semantic diff; host grants, absolute paths, caches and view preferences must remain excluded.

### C1 — Production architecture closure

Accept or replace ADR-004 and ADR-006 only after M1/L1/X1 prove the exact packaged supervised core and shell topology: launch and signing/bundling, one-writer lifecycle, WAL recovery, cancellation/backpressure, opaque resource authorization, renderer containment and same-document meaning. Record the decision in ADRs and the final receipt. CI compilation or compatible packaging alone cannot close C1.

A public release additionally requires explicit release authority. Passing these gates does not itself authorize publishing.

## Explicitly post-v1

- app-initiated rename, move, copy, folder creation, embed or Trash; all future source writes remain bound by ADR-008 Plan/confirm/journal/verify/reconcile;
- Excerpt authoring, clip ranges and derived editorial media;
- exact-duplicate review, similarity, perceptual indexing or any inferred creative relationship;
- formats beyond the current safe common-still set, including SVG, RAW, layered design files, video, audio and broad professional codecs;
- nested or smart Collections, tags/taxonomies, ratings, colour labels, saved searches and manual card ordering;
- Root deletion/forget workflows and destructive Library cleanup;
- optional local MCP, public CLI automation, plug-ins and updater/release-update systems;
- cloud sync, collaboration, sharing and universal DAM scope.

Post-v1 means absent from this execution run, not silently implemented behind an unfinished UI.

## Constitutional prohibitions

The following are not backlog items: accounts; required cloud services; telemetry; analytics or crash upload; embedded AI; model downloads; generated tags; semantic/model search; automatic creative judgment; assistant panes; path-, name-, hash- or scan-derived Asset identity; silent source overwrite or permanent delete; unrestricted renderer filesystem, shell, SQL, process, network or arbitrary IPC; remote content in privileged shells; browser storage as canonical state; disappearance of Missing material; ambient grid autoplay; Deck Workbench or Font Lab work in this repository.
