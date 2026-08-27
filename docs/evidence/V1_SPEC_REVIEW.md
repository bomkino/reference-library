# V1 Spec Review

## Review identity

```text
Contract: docs/specs/V1_EXECUTION_CONTRACT.md
Reviewed implementation SHA: c0b78116f8d7326474819815fd52b4a1c57f82f4
Reviewed implementation tree: 01835315338858e0ad73ade01e6a99f5d658299c
Branch: codex/reference-library-v1-completion
Reviewed: 27 August 2026 UTC
```

## Finding

V1-01 through V1-09 satisfy their source and compatible-runner acceptance clauses. No Critical or High source defect remains. V1-10 becomes complete only when the review/receipt commit is synchronized and exact-head CI passes. M1, L1, X1 and C1 remain target gates and are not closed by this review.

## Clause matrix

| Clause | Finding | Principal evidence |
|---|---|---|
| V1-01 safe schema evolution | Pass | Populated schema-1 migration preserves every canonical ID; deterministic injected failures at 1→2 and 2→3 restore the complete schema, ledger, `user_version` and Library metadata; WAL curation survives two supervised recovery cycles; corrupt/future input is preserved and rejected. |
| V1-02 Root lifecycle | Pass | A moved absolute provider path rebind keeps Root, Source, SourceRevision, Location, AssetOrigin and Asset IDs; wrong-session, unknown/path-shaped Root and raw-path attempts return typed path-free errors; cancellation, terminal jobs and honest unavailable states are proved. |
| V1-03 real renditions | Pass, source | JPEG/PNG/WebP decode, EXIF orientation, provider/version cache, invalidation, pixel/byte limits and catalogue-only failure pass. Cooperative cancellation is bounded to two workers and ten queued work items. A real decoder-boundary hang makes the Linux supervisor kill the Core, fail all requests, emit one fixed freeze event, restart, reopen and recover the identical canonical digest. The third-party decoder is not interrupted in-process; packaged-target behavior remains C1. |
| V1-04 manual curation | Pass | Review/title/note edits survive rescan, external rename, Missing, reconnect, restore, helper crash and reopen. Empty/oversized/invalid/unknown/wrong-session cases are typed, path-free and non-mutating. Stable selection/focus and canonical inclusion pass. |
| V1-05 lexical query | Pass | Blank/default behavior, Unicode, literal `%`, `_` and `\\`, composed search+Root+review+availability+Collection+sort across three snapshot-pinned pages, change invalidation, 100,000-Asset Core bounds and bounded DOM all pass. |
| V1-06 flat Collections | Pass | CRUD and membership are optimistic, bounded and atomic; duplicate membership is idempotent; empty, NUL, oversized and case-fold duplicate names fail; empty/duplicate/oversized batches and wrong sessions do not partially write; delete retains Assets/Sources/originals; canonical parity passes. |
| V1-07 workspace | Pass, source | Editorial Contact Sheet remains the resting surface; Interface Scale, density and Preview zoom are independent; the complete keyboard journey, roving focus, stable selection, accessible names/states/announcements, explicit loading/empty/no-results/error/unsupported/Missing states and event-storm bounds pass. VoiceOver/Orca/compositor behavior remains M1/L1. |
| V1-08 package/runtime | Pass, compatible environments | Package-open intents are validated and serialized. Exact-source CI safely extracts pacman/AppImage/tar, validates modes/ASAR/helper/desktop/MIME/legal payloads, reproduces the setuid sandbox, launches the packaged app under X11 and a real headless Wayland socket, observes the workspace/Core journey plus acknowledged close and clean process exit, reopens via the packaged helper, and builds/validates the arm64 `.app.zip`. This is not Garuda or installed-Mac integration. |
| V1-09 canonical proof | Pass | Snapshot-bound digest and diagnostic pages are deterministic, byte/framing bounded and sufficient to isolate mismatches. Grants, paths, platform IDs, jobs, caches and preferences are excluded. Curation and Collection edits change the digest. The 100,000-Asset proof stays bounded and the host-neutral three-leg journey returns zero semantic diff. |

## Scope and claim audit

No source move/copy/Trash, Root deletion, similarity, duplicate review, Excerpts, broad professional formats, nested/smart Collections, tags, ratings, saved searches, MCP, updater, account, telemetry, cloud dependency or AI/model feature was added. Originals remain in place and the renderer receives fixed named operations plus opaque IDs only.

## Remaining proof

- M1: installed Apple-Silicon journey.
- L1: installed Garuda/Arch/KDE journey under Wayland and X11.
- X1: exact M1/L1 Mac → Garuda → Mac canonical journey.
- C1: accept or replace ADR-004 and ADR-006 from target topology evidence.
- Public release: explicit release authority after the gates above.

