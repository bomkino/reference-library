# Reference Library interface system

## Intent

Reference Library is an editorial work surface, not a dashboard. The interface uses oversized hierarchy, severe spacing, thick rules, direct language and one restrained signal colour. Brutalism here means legible structure and physical confidence, not hostility, noise or arbitrary ugliness.

The Contact Sheet remains the resting surface and the images remain the dominant content. Controls frame editorial work; they do not compete with it.

## Type authority

Reference Library locally bundles the seven CC0 WOFF2 binaries from [`bomkino/pitchdog-type-system` v13.0.0](https://github.com/bomkino/pitchdog-type-system/tree/v13.0.0), exact commit `786b4a2b671182319320f922b8de8f927ea3a002`. The app never fetches fonts at runtime. Exact file hashes and licence provenance live in [`THIRD_PARTY.md`](../../THIRD_PARTY.md).

Only the font binaries cross the repository boundary. The upstream CSS, tokens, documentation, examples and artwork have different licence terms and are not Reference Library source. This document defines the local mapping:

| Role | Family | Use |
|---|---|---|
| Interface body | PD Body | Controls, prose, labels and all default interface text |
| Editorial display | PD Head | Major page, panel and modal statements; not every heading |
| Literal metadata | PD Eyebrow | File facts, counts, terse status data and compact metadata |
| Explicit alternates | PD Head Alt / PD Body Alt | Deliberate named exceptions only; never automatic fallback |

Use the authentic variable-font anchors exposed by the bundled binaries: 400 for ordinary body text, 600 for body actions, and 500 or 600 for PD Head display. Do not synthesize faces or choose arbitrary in-between weights merely to make a line appear stronger. Hierarchy should come first from family, size, spacing and placement.

## Scale and spacing

Interface Scale changes the root sizing system. Typography, controls, spacing and panel dimensions grow together through `--ui-scale`. Thumbnail density and Preview zoom remain independent because they answer different needs.

The default system uses a 15 px root size at 100%. Ordinary controls use `max(44px, 3.5rem)`: 52.5 px at the default scale and never less than 44 px. Compact and icon-only controls use at least `max(44px, 2.75rem)`; the mark inside the target may be smaller.

Component padding and gaps use this closed scale:

| Token | Value |
|---|---:|
| `--space-1` | `0.25rem` |
| `--space-2` | `0.5rem` |
| `--space-3` | `0.75rem` |
| `--space-4` | `1rem` |
| `--space-5` | `1.5rem` |
| `--space-6` | `2rem` |
| `--space-7` | `3rem` |
| `--space-8` | `4rem` |

Use one token on every side that needs space; do not rely on incidental line height, a neighbouring element's margin or an icon's view box as padding. Fluid `clamp()` spacing is reserved for page and major-region gutters. Component padding, internal gaps and control spacing stay on the discrete scale so density remains explainable.

At supported narrow widths, Library and Inspector remain available in explicit, focus-managed drawers. Opening a drawer moves focus into it; closing restores the invoking control. Modal isolation still applies. Responsive work may rearrange commands, but it may not remove browsing or curation capability.

## Icon law

- Use the pinned `@phosphor-icons/react` 2.1.10 package through the shared `UiIcon` wrapper.
- Shared utility icons render at `1em` with the bold weight, `aria-hidden="true"` and `focusable="false"`.
- An icon accompanies or replaces a control label only when its meaning is conventional in context.
- Every icon-only control keeps a stable semantic `aria-label` and a matching native `title`; the SVG itself is decorative.
- Size the control target independently from the icon. Never enlarge a glyph to impersonate padding.
- Do not add hand-drawn utility SVGs, CSS-mask icons or icon-like Unicode characters. The generated product mark is the intentional exception and is not a utility icon.

## Visual law

- Cool paper field and near-black ink.
- One coral signal colour for selected or decisive state.
- Square corners, structural rules and hard offset shadows.
- Large editorial headings with compact line height.
- No gradients, glass, ambient motion, decorative charts or dashboard-card styling.
- Full descriptive copy stays visible; compact utility actions may use conventional icons with accessible names and native tooltips.

## Interaction law

- Every ordinary control has an oversized target; every compact control still has a 44 px floor.
- Pointer press feedback is short and physical. Keyboard operation stays instant.
- Focus uses a high-contrast blue ring and never disappears behind a modal or drawer.
- Every modal traps focus, supports Escape, excludes the background with `inert`, and restores prior focus.
- Preview loading, unavailable and ready states stay distinct. Zoom never moves focus away from the active control.
- A newly selected Asset immediately owns the Inspector. A failed load cannot leave the previous Asset's editable fields onscreen.
- Reduced-motion preferences suppress the remaining short transitions.

## Product mark

The mark shows a dog carrying itself through a reference frame that is too small to contain it. A single coral registration point marks the act of selection. It uses a cool field, sparse near-black geometry, one impossible relationship and one semantic accent. The side profile avoids turning the product into a generic pet mascot.

`scripts/generate-product-icon.mjs` is the source of truth for the committed SVG and 1024 px PNG. The in-product `ProductMark` uses the same geometry. Never edit a derivative alone.

## Change rationale

| Before | After | Why |
|---|---|---|
| Compact neutral utility shell | Oversized editorial-brutalist work surface | Gives the product a legible authored identity while keeping the Contact Sheet central. |
| 32 px-class controls | 52.5 px default controls with a 44 px floor | Improves pointer confidence and low-vision use without coupling controls to thumbnail density. |
| Inspector hidden below 860 px | Library and Inspector use explicit narrow-window drawers | Preserves daily-use capability while keeping focus and ownership unambiguous. |
| System-font and one-off type choices | Locally bundled PD Body, PD Head and PD Eyebrow roles | Makes hierarchy deterministic and available offline without importing separately licensed upstream design source. |
| Text glyphs, masks and one-off utility marks | Shared bold `1em` Phosphor icons with labelled controls | Establishes one visual grammar while preserving accessible names and target size. |
| Ad hoc component padding | Eight-step spacing scale with fluid region gutters only | Makes every inset and gap intentional, reviewable and consistent across scales. |
| Previous Asset could remain after a failed detail request | Selection clears stale details and offers Retry Asset | Prevents editing or reading the wrong Asset after a failure. |
| Modal semantics without full background exclusion | Focus trap, background `inert`, `aria-hidden` restoration and focus return | Makes visual, pointer and accessibility ownership agree. |
| Rounded contact-sheet placeholder icon | Dog crossing an undersized reference frame | Creates a distinct pitch.dog mark instead of generic productivity software. |
