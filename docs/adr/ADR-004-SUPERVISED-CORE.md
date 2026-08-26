# ADR-004 — Supervised Rust Core Process

**Status:** Proposed  
**Date:** 26 August 2026

## Proposed decision

Use one supervised Rust Reference Core shared by SwiftUI/WebKit and Electron. Shells own lifecycle and native powers. Core owns locking, SQLite, domain commands, queries, indexing, jobs and authorization. Control traffic uses framed typed messages; media uses opaque resource streaming.

## Evidence and remaining gate

P03 proved paging, cancellation and restart topology with a dependency-free Go helper. C1, M1 and L1 must still prove real Rust/WAL recovery, signing, bundling, target launch and resource backpressure before acceptance.
