# Editorial Shortlist and Compare

## Product problem

The original Asset Browser made local material visible. Reference Library made that material durable. Neither, by itself, completed the most important editorial loop:

```text
see many
→ retain a few
→ compare them directly
→ make a decision
→ record where the decision belongs
```

A pitch-deck designer should not need to remember four filenames, open four external windows, or create a permanent Collection merely to decide which frame carries a slide.

## Shortlist

Shortlist is a transient working set for the current Library session.

- Maximum: 32 Assets.
- Identity: stable Asset IDs, never paths.
- Scope: survives query, filter, sort and virtual-window changes while the Library remains open.
- Persistence: intentionally not canonical. Use a Collection for a durable set.
- Entry: `X`, modifier-click, the visible `+` control, or Shift-click across a loaded visible range.
- Removal: `X`, the visible check control, individual tray removal, or Clear.
- Order: explicit Earlier/Later controls decide which four candidates occupy Compare slots.

The Shortlist holds refreshed summaries rather than duplicating canonical state. When an Asset changes, every visible Shortlist surface receives the new title, review state, category, media information, tags, Used In values and revision.

## Compare Board

Compare Board displays the first four shortlisted Assets side by side.

- Shared Fit, 100% and 200% zoom.
- Optional normalized pan synchronization, so the same region stays aligned across differently sized images.
- Visible review, Tags and Used In context at the point of judgment.
- Individual Keep, Maybe and Reject actions.
- Native Open, Reveal and Copy Path actions.
- Honest catalogue-only placeholders for material without an image comparison surface.
- Complete modal isolation, focus entry, focus trapping, Escape closure and focus restoration.

Four is an explicit visual and memory bound—not an arbitrary implementation accident. Larger sets belong in the Shortlist or a Collection; direct comparison should remain legible. The first four Shortlist positions are visibly labelled as Compare slots so truncation is never mysterious.

## Batch curation

The Selection Tray can apply:

- Keep, Maybe, Reject or Clear review;
- additive tags;
- additive Used In provenance;
- Collection membership.

Batch edits are sequential and bounded. Each Asset is fetched immediately before deciding and writing, then updated with its current revision. One conflict does not erase successful neighbours; the outcome reports updated, already-matching and failed counts separately.

Inspector drafts remain authoritative. A batch or rapid-review action first asks the user to Save, Discard or Cancel. Input values are cleared only after the action is accepted, so cancelling a transition does not destroy typed tags, provenance or Collection intent.

## Rapid review

When an Asset card has focus:

- `1` — Keep
- `2` — Maybe
- `3` — Reject
- `0` — Unreviewed
- `X` — add/remove Shortlist
- `C` — add if needed and open Compare Board when at least two Assets are shortlisted
- Enter — Preview when supported; otherwise Open Original
- Arrow keys / Home / End — stable virtual-grid navigation

These shortcuts do not bypass revision checks, Inspector draft protection or native authority boundaries.

## Non-goals

- Shortlist is not a second Collection system.
- Compare Board is not a moodboard canvas.
- Batch curation does not mutate source files.
- The workspace never receives absolute paths.
- No similarity model, ranking score or automatic creative judgment chooses the winner.
