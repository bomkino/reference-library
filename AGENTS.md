# Repository Instructions

Read `CONTEXT.md`, `docs/product/PRODUCT_CONSTITUTION.md`, `docs/specs/TRACER_T01.md`, `docs/security/SECURITY_MODEL.md` and relevant ADRs before modifying source.

## Product rules

- Reference Library only. Do not add Deck Workbench or Font Lab work.
- No embedded AI, accounts, telemetry, cloud dependency or automatic creative judgment.
- Stable generated Asset IDs; paths belong to Locations.
- One project gets one Library.
- Original sources remain in place by default.
- Use named typed commands and opaque IDs. Never expose generic filesystem, shell, SQL, process or IPC powers to a renderer.
- Interface Scale, thumbnail density and media zoom are independent controls.
- Editorial Contact Sheet is the resting surface; no ambient autoplay or SaaS dashboard.
- Work in causal vertical slices. Test public seams, not coverage percentages.
- Keep `docs/evidence/DECISION_EVIDENCE_LOG.md` append-only.
- Never claim target integration without target-machine evidence.
- Never merge, release, deploy, force-push or change repository settings without authority.

## Current verification

```bash
python3 scripts/check_repository.py
```

Add commands here only after they exist and pass.
