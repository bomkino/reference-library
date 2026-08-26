# ADR-007 — Tiered Rendition Providers With Honest Capabilities

**Status:** Accepted  
**Date:** 26 August 2026

## Decision

Use a provider registry: safe common provider, platform provider, isolated converter/fallback, then explicit `CatalogueOnly`. Every result records provider, version, capability and failure. Preview failure never hides or deletes an Asset. Source SVG never enters the workspace DOM.
