# Changelog

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
