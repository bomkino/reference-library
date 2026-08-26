# ADR-008 — Source Writes Use Plan, Journal, Verify and Reconcile

**Status:** Accepted  
**Date:** 26 August 2026

## Decision

Future rename, move, copy, embed, folder creation or Trash follows `Plan`, confirm plan hash, execute steps, verify disk, reconcile identity, recover. No overwrite and no ordinary permanent delete. Partial completion is durable visible state.

T01 preserves this boundary but implements no source mutation.
