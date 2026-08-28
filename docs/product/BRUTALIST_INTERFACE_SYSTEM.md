# Reference Library interface system

## Intent

Reference Library is an editorial work surface, not a dashboard. The interface uses oversized hierarchy, severe spacing, thick rules, direct language and one restrained signal colour. Brutalism here means legible structure and physical confidence, not hostility, noise or arbitrary ugliness.

The Contact Sheet remains the resting surface and the images remain the dominant content. Controls frame editorial work; they do not compete with it.

## Scale model

Interface Scale changes the root sizing system. Typography, controls, spacing and panel dimensions grow together through `--ui-scale`. Thumbnail density and Preview zoom remain independent because they answer different needs.

The default system uses a 15 px root size at 100%. Ordinary controls use `max(44px, 3.5rem)`: 52.5 px at the default scale and never less than 44 px at 80%. At narrower supported widths, the Inspector moves below the Contact Sheet before the whole workspace stacks. It is not silently removed.

## Visual law

- Cool paper field and near-black ink.
- One coral signal colour for selected or decisive state.
- Square corners, structural rules and hard offset shadows.
- Large editorial headings with compact line height.
- No gradients, glass, ambient motion, decorative charts or dashboard-card styling.
- Full descriptive copy stays visible; compact utility actions may use conventional icons with accessible names and native tooltips.

## Interaction law

- Every ordinary control has an oversized target.
- Pointer press feedback is short and physical. Keyboard operation stays instant.
- Focus uses a high-contrast blue ring and never disappears behind a modal.
- Every modal traps focus, supports Escape, excludes the background with `inert`, and restores prior focus.
- Preview loading, unavailable and ready states stay distinct. Zoom never moves focus away from the active control.
- A newly selected Asset immediately owns the Inspector. A failed load cannot leave the previous Asset's editable fields onscreen.
- Reduced-motion preferences suppress the remaining short transitions.

## Product mark

The mark shows a dog carrying itself through a reference frame that is too small to contain it. A single coral registration point marks the act of selection. It uses a cool field, sparse near-black geometry, one impossible relationship and one semantic accent. The side profile avoids turning the product into a generic pet mascot.

`scripts/generate-product-icon.mjs` is the source of truth for the committed SVG and 1024 px PNG. The in-product `ProductMark` uses the same geometry. Never edit a derivative alone.

## Change rationale

| Before | After | Why |
| --- | --- | --- |
| Compact neutral utility shell | Oversized editorial-brutalist work surface | Gives the product a legible authored identity while keeping the Contact Sheet central. |
| 32 px-class controls | 52.5 px default controls with a 44 px floor | Improves pointer confidence and low-vision use without coupling controls to thumbnail density. |
| Inspector hidden below 860 px | Inspector reflows below the Contact Sheet | Preserves daily-use curation and avoids a false responsive success. |
| Text-only Rename and Delete utilities | Conventional edit and trash marks with accessible labels and tooltips | Reduces repeated chrome while keeping meaning available to keyboard and assistive technology. |
| Previous Asset could remain after a failed detail request | Selection clears stale details and offers Retry Asset | Prevents editing or reading the wrong Asset after a failure. |
| Modal semantics without full background exclusion | Focus trap, background `inert`, `aria-hidden` restoration and focus return | Makes visual, pointer and accessibility ownership agree. |
| Rounded contact-sheet placeholder icon | Dog crossing an undersized reference frame | Creates a distinct pitch.dog mark instead of generic productivity software. |
