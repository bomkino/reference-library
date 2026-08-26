# Append-Only Decision and Evidence Log

Do not rewrite or delete entries. Corrections append a superseding entry.

## 2026-08-26 — Repository truth

**Hypothesis:** remote `main` still matches execution contract.  
**Change:** none.  
**Fresh measurement:** GitHub connector and local fetch both resolved `main` to `622237237e4492292df91b8912f9109cb3a0bf1e`; clean tree contains only `LICENSE` and `README.md`.  
**Decision:** keep expected baseline; create isolated tracer branch. No reconciliation required.

## 2026-08-26 — Handover integrity

**Hypothesis:** uploaded package is complete and internally consistent.  
**Change:** extracted into non-repository scratch space only.  
**Fresh measurement:** all 671 entries passed `sha256sum -c PACKAGE_MANIFEST.sha256`.  
**Decision:** use package as binding execution contract; never commit full proof corpus.

## 2026-08-26 — Durable repository foundation

**Hypothesis:** a concise repository-owned constitution, glossary, tracer contract, ADR set, security model, provenance policy and boundary check can preserve the contract without importing the proof corpus.  
**Change:** materialized those documents plus the smallest CI job and root structure.  
**Fresh measurement:** `python3 scripts/check_repository.py`, JSON parsing and `git diff --check` passed; check found all 10 required files and no forbidden proof/legacy directories.  
**Decision:** keep foundation and commit as first causal increment.
