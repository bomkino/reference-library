# T02 Public Seam — Design It Twice Record

## External rename evidence

**Shape A:** match an unseen path to a missing Location by filename, size or content fingerprint. This works across more filesystems, but identical copies and recycled names manufacture certainty and make a hash an identity surrogate.

**Shape B:** accept a relocation only from a unique host file identity, an absent old path, a single live link and matching current-revision evidence. Otherwise preserve Missing and insert the observation separately.

**Selected:** B. False negatives remain visible and recoverable; false identity merges would silently corrupt curation.

## Location history

**Shape A:** mark the old Location missing and insert a new Location for the same Source. This retains occurrence history, but the T02 contract requires Location identity to survive a pure external rename and exposes multiple Locations before the product has a history surface.

**Shape B:** update the existing Location row in place after the strict relocation predicate passes.

**Selected:** B for T02. The stable Location ID continues to back selection and named reveal. Broader multi-location history remains deferred.

## Public command surface

**Shape A:** add a `reconcileRoot` command and shell controls.

**Shape B:** keep reconciliation inside the existing authorized `addRoot` scan and publish results through the existing bounded query and job events.

**Selected:** B. The workspace gains no authority, and a normal rescan is the causal public seam.
