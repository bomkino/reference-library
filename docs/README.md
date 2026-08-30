# Documentation map

Reference Library documentation has different kinds of authority. Read a document according to its class; a period-specific receipt is not current product policy, and a roadmap is not proof that a release exists.

## Living guidance

These documents describe the current source line and should change with the product:

- [`../README.md`](../README.md) — public project overview, installation and current source target.
- [`../CONTEXT.md`](../CONTEXT.md) — compact source status, vocabulary and open evidence gates.
- [`../AGENTS.md`](../AGENTS.md) — repository operating rules for contributors and agents.
- [`product/PRODUCT_CONSTITUTION.md`](product/PRODUCT_CONSTITUTION.md) — durable product and safety law.
- [`product/BRUTALIST_INTERFACE_SYSTEM.md`](product/BRUTALIST_INTERFACE_SYSTEM.md) — current type, icon, spacing, responsive and interaction law.
- [`product/ASSET_BROWSER_PARITY.md`](product/ASSET_BROWSER_PARITY.md) and [`product/EDITORIAL_SHORTLIST_AND_COMPARE.md`](product/EDITORIAL_SHORTLIST_AND_COMPARE.md) — current capability and editorial-decision model.
- [`security/SECURITY_MODEL.md`](security/SECURITY_MODEL.md) — current trust boundaries and fail-closed behavior.
- [`maintenance/REPOSITORY_MAINTENANCE.md`](maintenance/REPOSITORY_MAINTENANCE.md) — branch, CI, release, provenance and public-hygiene policy.
- [`roadmap/IMPLEMENTATION_FRONTIER.md`](roadmap/IMPLEMENTATION_FRONTIER.md) — completed increments, open target gates and deferred scope.

Architecture Decision Records are durable decisions with individual statuses. The [`adr/README.md`](adr/README.md) index is the entry point; a proposed ADR is not accepted architecture.

## Frozen execution contracts

Files under [`specs/`](specs/) are bounded contracts for completed increments. They preserve what had to be proved at that point. Do not silently rewrite them to match later versions or interface details. New work should add a new contract or change living guidance unless the historical contract itself was factually wrong.

## Historical evidence

Files under [`evidence/`](evidence/) are append-only decisions, reviews, ledgers and receipts. Their statements such as “not released”, an old version number or an earlier capability boundary are true in their recorded context and may be stale as descriptions of the current source tree.

Never rewrite `evidence/DECISION_EVIDENCE_LOG.md`. Add a dated entry or a new source-bound receipt instead. Machine-generated receipts attached to releases remain the authority for exact commits, workflow runs, artifacts and checksums.

## Release notes

Files under [`releases/`](releases/) describe one version and remain fixed after publication except for an explicit correction. The presence of a release-note file does not prove publication; only the matching immutable tag and public GitHub Release do.

- [`releases/0.2.0.md`](releases/0.2.0.md) — published 0.2.0 notes.
- [`releases/0.3.0.md`](releases/0.3.0.md) — 0.3.0 candidate notes until the matching release is public.

## Legal and dependency authority

[`../THIRD_PARTY.md`](../THIRD_PARTY.md) records selected direct dependencies and bundled-asset provenance. `DEPENDENCY-LICENSES.json` and `THIRD_PARTY-NOTICES.txt` are generated truth for complete locked shipped dependency graphs. [`../NOTICE`](../NOTICE) is the concise distributed notice.
