# ADR-004 — Supervised Rust Core Process

**Status:** Proposed  
**Date:** 26 August 2026

## Proposed decision

Use one supervised Rust Reference Core shared by SwiftUI/WebKit and Electron. Shells own lifecycle and native powers. Core owns locking, SQLite, domain commands, queries, indexing, jobs and authorization. Control traffic uses framed typed messages; media uses opaque resource streaming.

## Evidence and remaining gate

P03 first proved paging, cancellation and restart topology with a dependency-free Go helper. Production V1 now proves the supervised Rust process, typed framing, bounded paging/events/cancellation, real rendition work, two-crash WAL recovery, decoder hard-timeout kill/restart and opaque-resource backpressure at source and compatible-package seams. M1 and L1 must still prove installed target launch, lifecycle and resource behavior; C1 will accept or replace this ADR from M1/L1/X1 evidence.
