# Changelog

## 0.3.1 — 2026-08-30

### Alignment and containment

- Rebalances icons, labels, carets and text inside buttons, disclosure headers, toolbars, panels and drawers.
- Normalizes caret size and the gap between disclosure icons and their labels.
- Keeps control heights, panel insets and cross-axis alignment coherent across wide, medium and narrow layouts.
- Contains long labels and constrained content without horizontal page overflow or clipped interactive controls.

### Interaction polish

- Keeps overlay surfaces from reflowing the canvas and gives local disclosures a measured open/close transition instead of an abrupt jump.
- Uses restrained, intent-led transitions and preserves immediate state changes under reduced motion.
- Extends visual QA around container balance, clipping, overflow, target size and expanded/collapsed layout states.
- Changes no `.pitchlibrary` schema, protocol or canonical document meaning.

### Release discipline

- Advances the release line to 0.3.1 / build 4 with self-consistent release notes and exact artifact names.
- Rejects a pre-existing version tag unless it resolves to the exact verified `main` source commit.
- Corrects stale candidate-only wording in the already-published 0.3.0 documentation without changing its feature history.

## 0.3.0 — 2026-08-30

### Typography and iconography

- Makes PD Body the default interface family, PD Head the major editorial-display family and PD Eyebrow the metadata/data family.
- Bundles all seven CC0 pitch.dog Type System v13 WOFF2 files locally for deterministic, offline use in both native hosts.
- Pins font provenance to `bomkino/pitchdog-type-system` tag `v13.0.0`, commit `786b4a2b671182319320f922b8de8f927ea3a002`, without copying its separately licensed CSS, tokens or documentation.
- Replaces improvised icon masks and icon-like control glyphs with `@phosphor-icons/react` 2.1.10 through one accessible icon wrapper.
- Maps interface emphasis to authentic variable-font anchors instead of arbitrary interpolated weights.

### Spacing and responsive polish

- Introduces a shared spacing scale for padding, layout gaps and region gutters.
- Preserves oversized ordinary controls and a 44 px minimum target for compact or icon-only actions at every Interface Scale.
- Normalizes icon/label gaps, panel insets, modal padding, shortlist controls, Compare actions and narrow-window command rows.
- Keeps Library and Inspector capability available through explicit, focus-managed responsive drawers.
- Adds durable synthetic visual QA across wide, medium, narrow and 80%/150% Interface Scale states, with font, overflow, clipping and 44 px target gates.
- Changes no `.pitchlibrary` schema, protocol or canonical document meaning.

### Release discipline

- Advances the release line to 0.3.0 / build 3 with dedicated release notes and provenance documentation.
- Keeps exact-main CI, checksums, source-bound receipts and explicit publication authority as release gates. This changelog entry does not itself claim CI or publication success.

## 0.2.0 — 2026-08-29

### Asset Browser parity

- Catalogues common images, design files, documents, video, audio, fonts and archives without conflating catalogue support with preview support.
- Adds Grid, Compact and List modes, optional related-thumbnail mosaics, richer facets and file-size sorting.
- Restores native Open Original, Reveal Source and Copy Path actions while keeping absolute paths inside the native host.
- Adds durable tags and Used In provenance plus opt-in 60-second Root rescanning.

### Editorial comparison and curation

- Adds a transient, bounded 32-Asset Shortlist that survives filtering and paging within the open Library session.
- Adds a modal Compare Board for up to four references with shared zoom, per-Asset review and native source actions.
- Adds batch review, tags, Used In and Collection membership from the Shortlist.
- Adds `X` shortlist, `C` compare and `1`/`2`/`3`/`0` rapid-review shortcuts.
- Refreshes each Asset immediately before rapid or batch writes, preventing stale revisions after saved Inspector edits or external changes.
- Refreshes every visible parity field after curation so cards, Inspector, Preview and Shortlist do not disagree.

### Interface and user journey

- Rebuilds first-run, no-Library, empty-Library, no-results, unsupported and failure states as deliberate parts of the product journey.
- Strengthens hierarchy, spacing, touch targets and editorial chrome without turning the app into a SaaS dashboard.
- Preserves the Inspector through narrow-window reflow and adds a settled responsive drawer journey.
- Tightens keyboard order, focus restoration, modal isolation, accessible labels and reduced-motion behaviour.
- Adds desktop and narrow-layout screenshot/computed-style audits, then removes the temporary audit scaffolding from the repository.

### Verification repairs

- Updates stale macOS and Linux bridge-v4 contract fixtures.
- Boxes large protocol response payloads to restore Clippy’s enum-size boundary without changing serialized wire meaning.
- Adds causal tests for shortlist bounds, range selection, comparison limits, batch partial failure, fresh-revision writes and visible metadata refresh.

## 0.1.0 — 2026-08-28

First public Reference Library release.

### Product

- Local, account-free and telemetry-free project Libraries.
- Authorized Root discovery, reconnect, rescan and cancellation.
- Bounded image renditions, editorial Contact Sheet, search, filters and sorting.
- Manual review, titles, notes and flat Collections.
- Independent Interface Scale, thumbnail density and Preview zoom.

### Release refinements

- Introduced the oversized editorial-brutalist interface and product mark.
- Preserved the Inspector through narrow-window reflow.
- Added complete modal isolation and focus restoration.
- Prevented stale Inspector details after a failed Asset request.
- Fixed canonical macOS temporary paths for SQLite NOFOLLOW storage.
- Authorized the chosen parent folder so sandboxed Core can preserve sibling-staged, atomic Library creation.
- Fixed Finder package selection so Open Library authorizes the `.pitchlibrary` package instead of its containing folder.
- Opened the granted canonical package or Root directly with no-follow flags and retained device/inode verification, avoiding sandbox-denied ancestor enumeration.
- Fixed clean-source identity checks across macOS `/var` and `/private/var` aliases.
- Removed a case-only test-directory collision and made the native source contract part of the ordinary test command.

### Distribution limits

- The macOS application is ad-hoc signed and not notarized. Apple-Silicon users must approve its first launch through Finder or Privacy & Security.
- Ubuntu CI validates Linux packages and packaged X11/Wayland journeys. Garuda/KDE hardware integration, cross-host X1 and production-architecture C1 remain open evidence gates.
