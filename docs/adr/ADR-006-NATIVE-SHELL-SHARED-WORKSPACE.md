# ADR-006 — Native Shell Plus Shared Workspace

**Status:** Proposed  
**Date:** 26 August 2026

## Proposed decision

macOS uses a SwiftUI document shell hosting the shared workspace through WebKit. Garuda uses a hardened Electron main/preload shell hosting the same workspace through Chromium. Shells own dialogs, grants, menus, reveal and helper supervision. Shared workspace owns the visual Library surface. One visible panel has one owner.

M1 and L1 remain mandatory before acceptance.
