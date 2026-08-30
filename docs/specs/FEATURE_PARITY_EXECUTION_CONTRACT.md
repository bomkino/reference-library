# Feature-Parity Execution Contract

> **Historical contract:** fulfilled by the 0.2 source increment and now frozen. Read [`CONTEXT.md`](../../CONTEXT.md), the [implementation frontier](../roadmap/IMPLEMENTATION_FRONTIER.md) and current release notes for present status. Period-specific wording below is preserved as acceptance evidence.

## Goal

Restore the useful breadth and speed of the original Pitch Deck Tools Asset Browser without reintroducing path-derived identity, generated HTML as state, browser-local canonical data, silent decoder failures, unrestricted path exposure, or source mutation.

## Required user capability

A person can connect project folders; catalogue broad creative media; browse in Grid, Compact, or List mode; optionally see related-thumbnail mosaics; search and facet by category, file type, media family, tags, Used In, Root, review, availability, and Collection; sort by name, added date, review state, or byte size; preview safely supported material; open or reveal originals; copy a path through the native host; and opt into periodic rescanning.

## Acceptance ledger

### FP-01 — Broad honest catalogue

Recognise common still images, browser-native images, design files, documents, video, audio, fonts, and archives. Catalogue support and preview support remain separate capability states. A missing renderer never makes an Asset disappear.

### FP-02 — Durable editorial parity

Tags and Used In provenance are bounded, normalized, transactional, searchable, filterable, canonical, and stable across reopen, rename, Missing, reconnect, and cross-host proof.

### FP-03 — Facets and sorting

Category, extension, media family, tags, Used In, Root, review, availability, and Collection filters page deterministically. Size sorting uses stable Asset-ID tie-breaks. Facet responses remain bounded.

### FP-04 — Three browse modes

Grid, Compact, and List use the same stable selection model and bounded virtual window. Switching mode does not change query meaning, review state, Preview zoom, or Interface Scale.

### FP-05 — Optional multiple thumbnails

Related-thumbnail mosaics are explicit, deterministic, bounded, and independently toggleable. Turning them off returns to a single primary thumbnail without changing identity or density.

### FP-06 — Native source actions

Open Original, Reveal Source, and Copy Path are named native capabilities. The host resolves the Location. Absolute paths never enter the embedded workspace. Wrong-session and unknown-Location attempts fail closed with path-free errors.

### FP-07 — Opt-in automatic reconciliation

Automatic rescanning is disabled by default, stored as host-local preference, runs at a 60-second cadence only while enabled, skips Roots already busy, and does not create overlapping unowned work.

### FP-08 — Private media delivery

Supported image, PDF, video, audio, font, and text previews use opaque session-scoped resources. Byte ranges are validated before scarce-handle accounting. Malformed ranges fail without leaking handles or paths.

### FP-09 — Migration and canonical proof

Schema v4 migrates atomically and rolls back cleanly under injected failure. New durable metadata changes the canonical digest; host preferences, caches, absolute paths, and preview capability observations do not.

### FP-10 — Compatible-package closure

The exact branch must pass repository, Rust, workspace/Linux source, Linux package/runtime, and Apple-Silicon package jobs. Compatible CI does not close Apple-Silicon, Garuda/KDE, cross-platform, or production-architecture target gates.


### FP-11 — Editorial shortlist and visual comparison

A person can build an ordered, session-local Shortlist without changing the active query or canonical Library. The Shortlist is bounded to 32 stable Asset IDs; its first four ordered positions feed a side-by-side Compare Board. Reordering is explicit and keyboard-accessible. The Compare Board supports Fit, 100%, and 200% views, optional normalized pan synchronization across differently sized images, review actions, and native Open/Reveal/Copy Path operations.

Batch review, Tags, Used In, and Collection membership operate only on the explicit Shortlist. Each Asset is refreshed before mutation, unchanged Assets are skipped, revision conflicts fail individually, successful mutations remain committed, and the result reports updated, skipped, and failed counts. Filtering, paging, or leaving Preview does not silently discard Shortlisted identities; closing the Library does.

## Intentional boundary

Font consolidation is not a Reference Library capability. It copies source files and belongs to the standalone font product. Reference Library may catalogue, preview where supported, open, reveal, and copy paths for font assets without becoming a second font manager.

## Promotion boundary

Compatible CI cannot close representative Apple-Silicon, Garuda/KDE, cross-host or production-architecture gates. An explicitly authorized public release may proceed with those gates open only when the release notes and receipts state the limitations plainly; release status must never be presented as target-integration evidence.
