# ADR-006 — Native Shell Plus Shared Workspace

**Status:** Proposed  
**Date:** 26 August 2026

## Proposed decision

macOS uses a SwiftUI document shell hosting the shared workspace through WebKit. Garuda uses a hardened Electron main/preload shell hosting the same workspace through Chromium. Shells own dialogs, grants, menus, reveal and helper supervision. Shared workspace owns the visual Library surface. One visible panel has one owner.

Production V1 source and compatible-package CI now prove both fixed native bridges, the shared bounded workspace, package-open serialization, session authority and zero-diff host-neutral document meaning. M1 and L1 remain mandatory for installed shell behavior; X1 and C1 remain mandatory before acceptance.
