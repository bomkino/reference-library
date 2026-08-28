# Asset Browser Parity

## Product decision

Reference Library is the durable successor to the original Pitch Deck Tools Asset Browser. It should retain the old tool’s useful visual-research breadth without retaining its path-based identity, generated-HTML architecture, browser-local canonical state, silent failures, or unrestricted path exposure.

## Restored capabilities

| Original Asset Browser capability | Reference Library implementation |
|---|---|
| Scan local folders | Authorized Roots with reconnect, rescan, cancellation, and durable identity |
| Generate thumbnails | Bounded core renditions plus honest browser-native/private streamed previews |
| Search | Local lexical query across name, title, note, tags, Used In, extension, and media family |
| Filter by category | Category facets and chips |
| Filter by file type | Extension and media-family facets and chips |
| Filter by tags | Durable tag facets and chips |
| Track where material was used | Durable **Used In** provenance and facets |
| Sort by name/date/size | Stable name, added-date, review-state, and byte-size sorts |
| Grid / compact / list | Three virtualized browsing modes |
| Multiple thumbnails | Optional related-thumbnail mosaic; independent from density and interface scale |
| Notes | Durable bounded editorial notes |
| Open original | Named native host action |
| Reveal containing folder | Named native host action |
| Copy absolute path | Native host copies directly to the system clipboard; the workspace never receives the path |
| Automatic refresh | Explicit opt-in 60-second Root rescanning that skips busy Roots |
| Broad formats | Catalogue recognition for common images, design files, documents, video, audio, fonts, and archives |
| Preview broad media | PDF, browser-native images, video, audio, fonts, and text use private bounded delivery; unsupported renderers remain visible as catalogue-only assets |

## Deliberate improvements

- Generated Asset identity replaces path-hash identity.
- A `.pitchlibrary` document replaces generated HTML and browser storage.
- Renames, Missing states, disconnected volumes, and Root reconnects preserve curation.
- Tags, Used In, titles, notes, review state, and Collections participate in canonical project meaning.
- Large Libraries remain paged and virtualized rather than loading every row or card.
- Native actions are capability-based. Absolute paths never cross into the embedded workspace.
- Preview support is stated honestly per format instead of swallowing decoder failures.

## Intentional boundary

The old **Consolidate Fonts** command is not part of Reference Library. Font consolidation copies source files and belongs to the standalone font product. Reference Library catalogues font files, previews safely supported fonts, and can open, reveal, or copy their paths without becoming a second font manager.

## Remaining target proof

Source and compatible-runner proof do not replace real use. Feature-parity promotion still requires exact packaged journeys on Apple-Silicon macOS and Garuda/Arch/KDE, plus a real cross-platform Library round trip.
