# ADR-003 — Live Library Is a Package Directory

**Status:** Accepted  
**Date:** 26 August 2026

## Decision

```text
Project.pitchlibrary/
├── manifest.json
├── library.sqlite
├── embedded/
└── README.txt
```

Derived caches and permission grants stay outside the neutral document. Transfer ZIP is explicit transport, never the live editing container.

## Consequences

SQLite retains normal WAL behavior; embedded bytes remain ordinary files; manifest replacement and DB transactions remain inspectable failure domains. Finder and Dolphin presentation remain target gates, not reasons to change canonical meaning.
