# Brutalist interface accessibility seams

The visual rebuild must preserve these observable behaviors:

- Interface Scale changes the whole sizing system; thumbnail density and Preview zoom remain independent.
- Default ordinary controls are at least 3.5 rem tall.
- Focus is never communicated by colour alone and remains visible against paper, signal and ink surfaces.
- Keyboard navigation, selection, Preview, save/discard/cancel and Root operations retain their existing order and semantics.
- Modal surfaces own focus and exclude the application beneath them.
- The Inspector remains available through supported narrow-window reflow.
- Reduced-motion preferences remove nonessential transition duration.
- Product marks are decorative and never become extra accessibility-tree noise.
- Thick rules and hard shadows do not replace labels, status text or error copy.
