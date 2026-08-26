# T01 — First Production Tracer

## User capability

Create or open one project Library, authorize one Root, see common still images appear progressively in a calm contact sheet, select and preview one stable Asset through an opaque resource, reveal its Location natively, close the Library, and reopen identical canonical meaning through the other platform shell or host-neutral harness.

## Canonical slice

Required: `Library`, `Root`, `Source`, `SourceRevision`, `Location`, `Asset`, `AssetOrigin(kind=Whole)`, `Rendition`, `Job`.

Migration 1 contains only this durable slice. Asset IDs are generated and never derived from path, filename, hash, scan order or row order. Missing source remains state, never implicit deletion.

## Public seams

```text
LibrarySession.create/open/close
LibrarySession.addRoot
LibrarySession.queryAssets(windowed)
LibrarySession.subscribe(events)
LibrarySession.authorizeResource
WorkspaceBridge.chooseRoot
WorkspaceBridge.revealLocation
WorkspaceBridge.queryCapability
CoreSupervisor.start/restart/stop
CanonicalDump.generate
```

Control messages are versioned and framed. Large media bytes never travel through control JSON. Long work supports events and idempotent cancellation. A helper crash freezes writes until restart.

## Interface acceptance

- Editorial Contact Sheet opens by default.
- Bounded virtualization; 100,000 Assets are never serialized or rendered wholesale.
- Selection and focus remain stable as pages arrive.
- Interface Scale supports at least 80%, 100%, 125% and 150% independently of thumbnail density.
- Loading, empty, error, unsupported and missing states are explicit.
- Static at rest; visible keyboard focus; stable panel geometry.
- Renderer state and URLs contain opaque IDs, not absolute source paths.

## Causal acceptance

- Package creation rejects invalid or future manifests, locks one writer, closes and reopens atomically.
- Initial discovery and reopen preserve generated Asset IDs.
- Paging returns deterministic windows with stable tie-breaks.
- Valid session/Asset/profile authorizes Preview; raw path, wrong session and closed session fail.
- Forced helper exit emits no false completion, preserves committed metadata and supports restart.
- Electron and Swift adapters expose the same named bridge contract.
- Canonical dumps exclude grants, caches, provider paths, window state and expected volatile timestamps; remaining semantic diff is empty.

## Non-goals

No source move/copy/Trash, similarity, duplicate review, Excerpts, broad professional formats, MCP, public release, updater, cloud sync or universal DAM work.
