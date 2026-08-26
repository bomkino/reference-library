# T01 Public Seam — Design It Twice Record

## Core control protocol

**Shape A:** generic `{method: string, payload: any}` RPC with method routing in each shell. Small initial surface, but typo-prone, difficult to version exhaustively and too easy to grow arbitrary operations.

**Shape B:** versioned framed `Command` and `CommandResult` tagged unions shared by callers, with bounded projections and explicit events. More declarations, but one exhaustive vocabulary and clean rejection of unknown/future input.

**Selected:** B. Control JSON stays below 1 MiB; Asset pages cap at 250; media bytes use custom resources.

## Preview resource

**Shape A:** renderer asks for a source/cache path or receives a `file://` URL. Simple, but turns one UI compromise into broad filesystem read and leaks project paths.

**Shape B:** renderer uses session-scoped `pitchdog-asset://<session>/<asset>/<profile>`. Privileged shell asks core for a validated descriptor and never forwards its native path.

**Selected:** B. Session close invalidates authorization.

## Native reveal

**Shape A:** generic `openPath(path)` bridge. Flexible but caller-controlled and equivalent to a broad native capability.

**Shape B:** `revealLocation(locationId)`; core resolves the ID inside the active authorized Root, then platform adapter calls Finder or Dolphin/default file manager.

**Selected:** B. Platform absence returns a named capability state.
