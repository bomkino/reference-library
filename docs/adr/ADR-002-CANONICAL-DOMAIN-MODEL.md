# ADR-002 — Separate Source, SourceRevision, Location, Asset and AssetOrigin

**Status:** Accepted  
**Date:** 26 August 2026

## Decision

`Source` is file lineage; `SourceRevision` is immutable observed content; `Location` is one storage occurrence; `Asset` is stable user-facing curation; `AssetOrigin` selects the whole Source or a non-destructive Excerpt. Renditions remain disposable.

## Consequences

Content rewrite creates a Revision while Asset identity may remain stable. Merge and split operate on Origins, not bytes. One Source may have several Locations; exact copies may have separate Sources.
