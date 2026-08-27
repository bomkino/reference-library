# T02 — External Rename Reconciliation

## User capability

Rescan an authorized Root after a common still was renamed outside Reference Library. When strong filesystem and revision evidence identifies one unambiguous relocation, preserve the existing Source, Location and Asset IDs while updating the Location path. When that evidence is absent or ambiguous, retain the old Asset as Missing and catalogue the observed file separately.

## Canonical slice

T02 reuses migration 1. The existing `locations.platform_file_id` and `platform_file_id_kind` fields hold host reconciliation evidence; they are excluded from the neutral canonical dump. No new durable entity, source-operation journal or schema version is required.

Asset, Source and Location IDs remain generated identities. Platform file IDs, paths, names, timestamps, sizes and fingerprints are evidence only and never become durable identity.

## Reconciliation rule

A newly observed path may relocate one existing Location only when all of the following hold:

- the host supplies a platform file ID;
- exactly one Location in the same authorized Root has that platform file ID and kind;
- the candidate has one filesystem link, so a second live occurrence is not being collapsed;
- the stored path is absent, rather than unreadable or replaced;
- byte size and quick fingerprint match the Source's current Revision.

The relocation updates the existing Location row and returns its Source to `active`. If any condition fails, the scanner inserts a separate Source, Location and Asset for the new observation. The unseen old Location becomes `missing`; its Asset and curation remain.

## Existing public seams

```text
LibrarySession.addRoot
LibrarySession.queryAssets(windowed)
LibrarySession.authorizeResource
LibrarySession.resolveLocation
CanonicalDump.generate
```

No renderer or shell authority is added. Existing terminal job events cause the bounded workspace to refresh.

## Causal acceptance

- A same-filesystem external rename preserves Source, Location, Asset, AssetOrigin and SourceRevision IDs.
- The renamed Asset reports its new display path and remains previewable and revealable.
- Delete-plus-copy with identical bytes does not infer identity from content; the old Asset is Missing and a distinct present Asset is created.
- Missing then restoring the original path returns the original Source to `active` without replacing its Asset ID.
- Close/reopen preserves the reconciled canonical meaning.
- T01 paging, cancellation, restart, security and semantic-round-trip checks remain green.

## Non-goals

No app-initiated rename, move, copy or Trash; no merge, relink confirmation UI, duplicate review, similarity, Excerpts, new format coverage or migration 2.
