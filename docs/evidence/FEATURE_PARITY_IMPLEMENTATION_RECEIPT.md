# Feature-Parity Implementation Receipt

## Status

**Implementation complete and released as 0.2.0. Compatible source and package verification passed. Target integration remains unclaimed.**

This receipt records the feature-parity, editorial-decision and source-truth work promoted through pull request #4 into release 0.2.0. Explicit merge and release authority was granted on 2026-08-29.

Exact product source after the editorial decision-loop and source-truth repairs:

```text
9e821c18815b0381e310de7806cd227a8bd18b49
```

Clean automation-free verification head:

```text
bcb52571fe79bc7bbc7a767c9487dcbf4b2de149
```

Authoritative pull-request workflow:

```text
run: 33233311053
head: bcb52571fe79bc7bbc7a767c9487dcbf4b2de149
result: five of five jobs passed
```

The cleanup commit changes no product, protocol, schema, test or package source. It removes the one-shot transformation workflows so only the ordinary repository CI remains.

## Product result

Reference Library restores the central useful breadth of the original Pitch Deck Tools Asset Browser while preserving durable identity, local canonical state, native authority boundaries, bounded work, and cross-platform document meaning.

Implemented:

- native Open Original, Reveal Source, and Copy Path actions;
- Grid, Compact, and List browsing modes;
- optional related-thumbnail mosaics;
- an ordered 32-Asset Shortlist with explicit first-four Compare slots;
- a four-up Compare Board with shared zoom, optional normalized pan synchronization, curation context, and native Open/Reveal/Copy Path;
- rapid review shortcuts and conflict-aware batch curation;
- category, extension/file-type, media-family, tag, Used In, Root, review-state, availability, and Collection facets;
- name, date-added, review-state, and file-size sorting;
- durable tags and Used In provenance;
- opt-in 60-second automatic Root rescanning;
- broad catalogue recognition for common images, design files, documents, video, audio, fonts, and archives;
- honest preview support for browser-native and safely streamed media, with catalogue-only states where no trusted renderer exists;
- range-aware private streaming for PDF, video, and audio;
- schema-v4 migration, rollback, reopen, facet, query, and canonical-digest coverage.

## Editorial decision pass

The parity build could find and inspect material, but a deck researcher also needs to retain candidates, compare them directly, decide, and apply the result without losing context. The editorial pass therefore adds:

- a transient Shortlist capped at 32 Assets;
- range extension across the virtual contact sheet;
- explicit ordering, with the first four Shortlist positions becoming Compare slots;
- an ordered four-up Compare Board with shared Fit, 100%, and 200% zoom;
- optional normalized pan synchronization across differently sized images;
- visible review, Tags, and Used In context;
- explicit placeholders for catalogue-only and unavailable candidates;
- per-candidate Keep, Maybe, Reject, Open, Reveal, and Copy Path actions;
- accessible Shortlist reordering;
- batch review, tag, Used In, and Collection operations;
- keyboard shortcuts for shortlist, compare, and rapid review;
- partial-conflict reporting instead of all-or-nothing concealment;
- revision-safe save-then-review and batch writes;
- full visible-summary refresh after tags, Used In, size, category, MIME, extension, or preview capability changes;
- recoverable Inspector failure state with stale Asset details removed.

The Shortlist is intentionally session-local. It is a working comparison surface, not hidden canonical project meaning. Durable decisions belong in review state, Tags, Used In, notes, titles, and Collections.

## Corrected source truth

The deep pass found a conceptual defect in the parity model: source availability and preview capability had been conflated.

The corrected contract is:

- **present** — the source is physically readable;
- **unreadable** — the source cannot be safely read or decoded where decoding is required to establish source truth;
- **unsupported** — the source is readable and catalogued, but Reference Library has no trusted in-app renderer for it;
- preview capability is recorded separately from filesystem availability.

This prevents a readable PSD, archive, font or other catalogue-only source from being falsely reported as damaged. It also keeps oversized but readable sources present while still bounding thumbnail and preview work.

## Security and product boundaries

- Absolute paths remain confined to the native host.
- Copy Path writes directly to the system clipboard; JavaScript receives only success or failure.
- Original sources remain in place and are not mutated.
- The workspace does not gain unrestricted filesystem, shell, process, SQL, network, or arbitrary IPC access.
- Catalogue breadth is not described as universal preview breadth.
- Automatic rescanning is explicit and opt-in.
- Compare is capped at four visible candidates and Shortlist work is bounded at 32.
- Expanded query payloads remain indirectly stored so the framed protocol command remains bounded.
- Font consolidation remains outside Reference Library because it belongs to the standalone font product and would introduce a source-copy workflow into a currently non-mutating application.

## Fresh exact-head verification

Workflow run `33233311053` passed all five ordinary jobs against `bcb52571fe79bc7bbc7a767c9487dcbf4b2de149`:

### `repository-boundary`

- repository boundary check;
- generated product-icon check;
- release-metadata check.

### `rust-core`

- pinned Rust dependency audit;
- Rust formatting;
- Clippy with warnings denied;
- complete Rust workspace test suite;
- T01 semantic round trip;
- V1 semantic round trip.

### `workspace-and-linux-source`

- locked Node install;
- high-severity dependency audit;
- release Core build;
- TypeScript typecheck;
- complete Node/workspace tests;
- source builds;
- generated dependency-licence check;
- legal-bundle contract.

### `linux-package-directory`

- release Core and shared workspace builds;
- pacman, AppImage and tar package generation;
- exact extracted artifact validation;
- packaged renderer-boundary validation;
- Chromium sandbox ownership rehearsal;
- deterministic packaged journey under X11;
- packaged application journey under headless Wayland;
- extracted helper reopen;
- checksums and source-bound build-receipt verification.

### `macos-arm64-package`

- Swift tests;
- Apple-Silicon application build;
- extracted application validation;
- checksums and source-bound build-receipt verification.

## Known unclosed integration gates

Compatible CI is not representative target integration. Release 0.2.0 is public with these real-machine journeys still open:

- Apple-Silicon macOS;
- Jenai’s Garuda/Arch/KDE environment under Wayland and X11;
- one real Mac → Garuda → Mac Library round trip;
- production architecture closure based on those exact packaged results.

## Deliberate non-claim

Release 0.2.0 is not evidence that every broad catalogue format has a high-fidelity preview, that comparison ergonomics are proven in sustained daily pitch.dog work, or that representative target-machine integration is complete. Those limits remain explicit release facts.
