# ADR-010 — Automation Uses Named Commands and Stable IDs

**Status:** Accepted  
**Date:** 26 August 2026

## Decision

Human UI, native menus, local CLI and future optional local MCP use one typed command vocabulary. Mutations target stable IDs. Source changes use plan/apply. No arbitrary shell, SQL, path, network or IPC capability is exposed.
