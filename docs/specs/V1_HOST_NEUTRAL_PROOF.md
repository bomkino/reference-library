# V1 Host-Neutral Canonical Proof

## Purpose

This harness is source evidence for shared document meaning. It is not M1, L1 or X1 and never substitutes host labels for installed target machines.

The proof extends the T01 create/reopen journey with durable manual curation, a flat Collection and bounded canonical diagnostics. It deliberately excludes native grants, provider paths, rendition caches, jobs and view preferences from comparison.

## Required Core seam

The V1 Core must expose these framed commands before `scripts/v1-semantic-roundtrip.mjs` can pass:

```text
create_library
open_library
close_library
add_root
query_jobs
query_assets
get_asset
update_asset
list_collections
create_collection
set_collection_membership
canonical_digest
canonical_page
```

`canonical_digest` returns a deterministic digest and per-entity counts from one read snapshot. Every `canonical_page` request carries that digest as `snapshotDigest`. The Core must either return a page proven against the requested durable snapshot or reject it with typed, path-free `CanonicalSnapshotChanged`; it must never silently page newer meaning.

## Journey

1. An Electron-labelled host-neutral supervisor creates one Library and discovers three common stills.
2. It curates one Asset and creates one Collection containing two Assets.
3. It records the bounded digest and every bounded diagnostic page, then closes.
4. A Swift-labelled host-neutral supervisor reopens the package, verifies identical digest/pages and directly checks curation and membership.
5. It curates another Asset and adds it to the Collection, records the new bounded proof, then closes.
6. An Electron-labelled return supervisor reopens and verifies the second proof plus both hosts' curation and all three memberships.

No request or result relies on a whole-document canonical dump. The harness follows `nextCursor` and verifies that each entity's observed record count equals the count bound into the digest.

## Passing result

The script emits JSON only after all assertions pass. Passing output reports three host labels, stable Library ID, two curated Assets, one Collection, three memberships and `semanticDiffCount: 0`.

Host-neutral success means source-ready semantic compatibility only. X1 remains open until exact M1/L1 builds complete Mac → Garuda → Mac with real reauthorization, external rename and Missing/restore evidence.
