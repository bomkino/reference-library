# Feature-Parity Implementation Receipt

## Status

**Draft pull-request source. Not merged. Not released. Not target-integrated.**

This receipt covers `codex/reference-library-feature-parity` and draft pull request #4. It does not authorize a merge or release.

The clean editorial decision-loop source commit is:

```text
92f673cdc2c81075fc1141302b9e1a2bfaa03c6d
```

Before that commit was written, the exact source passed its focused gate: patch integrity, TypeScript typechecking, Rust Core build, 46 workspace tests, 35 Linux/native source-contract tests, source builds, Rust formatting, and repository-boundary validation. The ordinary five-job matrix for this receipt-bearing head remains the authoritative compatible-package evidence.

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

## Security and product boundaries

- Absolute paths remain confined to the native host.
- Copy Path writes directly to the system clipboard; JavaScript receives only success or failure.
- Original sources remain in place and are not mutated.
- The workspace does not gain unrestricted filesystem, shell, process, SQL, network, or arbitrary IPC access.
- Catalogue breadth is not described as universal preview breadth.
- Automatic rescanning is explicit and opt-in.
- Compare is capped at four visible candidates and Shortlist work is bounded at 32.
- Font consolidation remains outside Reference Library because it belongs to the standalone font product and would introduce a source-copy workflow into a currently non-mutating application.

## Exact-head verification requirement

The receipt-bearing head must freshly pass:

- repository boundary, generated icon, release metadata, dependency-licence, and legal-bundle checks;
- TypeScript typechecking, Linux/native contract tests, workspace tests, and source builds;
- Rust formatting, Clippy with warnings denied, complete Rust tests, and T01/V1 semantic round trips;
- extracted Linux packages under X11 and headless Wayland;
- Swift tests and Apple-Silicon application build, extraction, checksums, and source-bound receipt validation.

The final workflow run ID and exact receipt-bearing SHA will be recorded only after that matrix completes.

## Remaining proof boundary

Compatible CI is not representative target integration. Before promotion, complete the real-machine journeys for:

- Apple-Silicon macOS;
- Jenai’s Garuda/Arch/KDE environment under Wayland and X11;
- one real Mac → Garuda → Mac Library round trip;
- production architecture closure based on those exact packaged results.

## Deliberate non-claim

This branch is a source and compatible-package candidate. It is not yet evidence that every broad catalogue format has a high-fidelity preview, that comparison ergonomics are proven in daily pitch.dog work, that the app is integrated on the target machines, or that a public release is ready.
