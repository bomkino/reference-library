# ADR-001 — Asset Identity Is Independent of Path

**Status:** Accepted  
**Date:** 26 August 2026

## Decision

Every durable Asset receives a generated stable ID. It is not derived from path, filename, content hash, result position, scan order or row order. Paths identify Locations; hashes and platform identifiers are reconciliation evidence only.

## Consequences

Rename, move and offline state can preserve curation. Exact copied bytes may remain separate Assets until explicit merge. Ambiguous relinking stays visible instead of manufacturing certainty.

## Evidence

P01 passed 20 state scenarios, including rename, cross-volume move, offline Root, duplicate copy, non-UTF-8 path and cross-platform round-trip semantics.
