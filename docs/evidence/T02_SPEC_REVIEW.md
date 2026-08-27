# T02 Spec Review

**Review date:** 27 August 2026 UTC  
**Reviewed remote source:** `3a55385afd21b32f2e7bb80a8b83661348e8d6b5`  
**Reviewed tree:** `e6bfa93a528804e2498153f01bfedc2ff2f88f55`  
**Contract:** product constitution, ADR-001/002/003/008, security model, `TRACER_T02.md` and `T02_PUBLIC_SEAM_DESIGN.md`.

## Verdict

The bounded T02 source contract is satisfied at the available public seams. No source-level blocker was found. Target integration is unchanged and unclaimed: M1, L1, X1 and C1 remain open.

## Requirements

| Requirement | Evidence | Finding |
|---|---|---|
| Start from verified T01 | Branch merge base is exact T01 remote head `858202c`; reviewed tree is three commits ahead and zero behind | Satisfied |
| Preserve Source, Location and Asset identity on an external rename | Unix device/inode evidence, single-link check, matching current Revision and absent old path update the existing Location row | Satisfied for the T02 predicate |
| Do not make path, filename or hash identity | Delete-plus-copy fixture has equal fingerprints but distinct Sources/Locations/Assets; original remains Missing | Satisfied |
| Preserve all canonical relationships | Pure rename fixture preserves Source, SourceRevision, Location, AssetOrigin and Asset IDs through close/reopen | Satisfied |
| Expose Missing honestly | Insufficient evidence retains the old Asset with `availability=missing`; a separately observed file is present | Satisfied |
| Restore original occurrence | Same-path return reactivates the original Source and Location without replacing Asset identity | Satisfied |
| Keep editorial selection stable | Loaded selection and Preview summaries rebind by Asset ID after terminal scan refresh | Satisfied |
| Preserve native/renderer boundary | Reconciliation remains inside `addRoot`; no bridge command, path result or source-mutation capability was added | Satisfied |
| Preserve T01 | Package, paging, 100,000-Asset window, restart, opaque resource, shell and zero-diff semantic checks remain green | Satisfied in local source verification |
| Avoid migration without durable need | Existing platform evidence columns are used and remain excluded from canonical dump; schema stays at version 1 | Satisfied |

## Deliberate limits

- Reconciliation is intentionally conservative. Unsupported host identity, multiple matching rows, multiple hard links, an unreadable/replaced old path, or mismatched revision evidence produces Missing plus a separate observation.
- Existing T01 Libraries have no stored platform file ID until a T02 scan observes the still at its known path. A rename before that observation cannot be inferred safely.
- Cross-volume relocation usually changes platform identity and is not treated as T02 rename. Confirmed relinking and broad move history remain future work.
- T02 is scan-driven; it adds no filesystem watcher or app-initiated rename.
- Device/inode behavior compiled and passed on compatible Linux. Apple-Silicon compilation/package evidence comes from CI; real APFS/Finder behavior remains inside M1.

## Deferred-scope check

No app-initiated move/copy/Trash, source-operation journal execution, merge control, relink UI, duplicate review, similarity, Excerpts, broad format support, MCP, AI, account, telemetry, cloud dependency, release or deployment was added.

## Conclusion

T02 makes one conservative identity decision at the existing scan seam. Ambiguity remains visible instead of silently joining curation. No repair is required before exact-head CI and receipt closure.

## Exact-source CI follow-up

GitHub Actions run `33040429601` passed all five jobs at review/receipt source `39c1a20f9ee1ef04af1774b69368dbe0d0ee8362`, including the three Unix T02 fixtures on Ubuntu, Apple-Silicon Swift/package compilation, full Linux packages and source-bound receipts. **Finding:** T02 is source-ready. M1, L1, X1 and C1 remain open and no target-integration claim is added.
