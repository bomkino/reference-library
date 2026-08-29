# Changelog

## Unreleased — 0.2 candidate

### Asset Browser parity

- Catalogues common images, design files, documents, video, audio, fonts and archives without conflating catalogue support with preview support.
- Adds Grid, Compact and List modes, optional related-thumbnail mosaics, richer facets and file-size sorting.
- Restores native Open Original, Reveal Source and Copy Path actions while keeping absolute paths inside the native host.
- Adds durable tags and Used In provenance plus opt-in 60-second Root rescanning.

### Editorial comparison and curation

- Adds a transient, bounded 32-Asset Shortlist that survives filtering and paging within the open Library session.
- Adds a modal Compare Board for up to four references with shared zoom, per-Asset review and native source actions.
- Adds batch review, tags, Used In and Collection membership from the Shortlist.
- Adds `X` shortlist, `C` compare and `1`/`2`/`3`/`0` rapid-review shortcuts.
- Refreshes each Asset immediately before rapid or batch writes, preventing stale revisions after saved Inspector edits or external changes.
- Refreshes every visible parity field after curation so cards, Inspector, Preview and Shortlist do not disagree.

### Verification repairs

- Updates stale macOS and Linux bridge-v4 contract fixtures.
- Boxes large protocol response payloads to restore Clippy’s enum-size boundary without changing serialized wire meaning.
- Adds causal tests for shortlist bounds, range selection, comparison limits, batch partial failure, fresh-revision writes and visible metadata refresh.

## 0.1.0 — 2026-08-28

First public Reference Library release.

### Product

- Local, account-free and telemetry-free project Libraries.
- Authorized Root discovery, reconnect, rescan and cancellation.
- Bounded image renditions, editorial Contact Sheet, search, filters and sorting.
- Manual review, titles, notes and flat Collections.
- Independent Interface Scale, thumbnail density and Preview zoom.

### Release refinements

- Introduced the oversized editorial-brutalist interface and product mark.
- Preserved the Inspector through narrow-window reflow.
- Added complete modal isolation and focus restoration.
- Prevented stale Inspector details after a failed Asset request.
- Fixed canonical macOS temporary paths for SQLite NOFOLLOW storage.
- Authorized the chosen parent folder so sandboxed Core can preserve sibling-staged, atomic Library creation.
- Fixed Finder package selection so Open Library authorizes the `.pitchlibrary` package instead of its containing folder.
- Opened the granted canonical package or Root directly with no-follow flags and retained device/inode verification, avoiding sandbox-denied ancestor enumeration.
- Fixed clean-source identity checks across macOS `/var` and `/private/var` aliases.
- Removed a case-only test-directory collision and made the native source contract part of the ordinary test command.

### Distribution limits

- The macOS application is ad-hoc signed and not notarized. Apple-Silicon users must approve its first launch through Finder or Privacy & Security.
- Ubuntu CI validates Linux packages and packaged X11/Wayland journeys. Garuda/KDE hardware integration, cross-host X1 and production-architecture C1 remain open evidence gates.
