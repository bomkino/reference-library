# Third-Party Software and Provenance Policy

No source has been copied from the proof corpus, legacy Asset Browser or an external repository.

Before direct code reuse, record:

- capability and reason for reuse;
- repository and exact commit or tag;
- copied files, crates or packages;
- licence and copyright holder;
- local modifications;
- security implications and verification fixture;
- corresponding notice location.

Do not copy unknown-licence, proprietary, source-available-only, noncommercial, private, client or paid-font material. Package-manager dependencies must be exact-lockfile reproducible. `DEPENDENCY-LICENSES.json` becomes generated truth once dependency graphs exist.

## Direct dependencies

Current direct dependencies are implemented from their public APIs; no dependency source is copied into this repository.

| Package | Version | Licence | Purpose | Source |
|---|---:|---|---|---|
| `imagesize` | 0.15.0 | MIT | Bounded common-still dimension probe | crates.io |
| `rusqlite` | 0.40.2 | MIT | SQLite canonical state; bundled SQLite feature | crates.io |
| `serde` | 1.0.229 | MIT OR Apache-2.0 | Typed protocol and manifest serialization | crates.io |
| `serde_json` | 1.0.151 | MIT OR Apache-2.0 | Framed JSON and canonical values | crates.io |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 | Quick reconciliation fingerprint | crates.io |
| `thiserror` | 2.0.20 | MIT OR Apache-2.0 | Typed internal errors | crates.io |
| `uuid` | 1.25.0 | Apache-2.0 OR MIT | Generated stable IDs and session tokens | crates.io |

Exact transitive versions live in `Cargo.lock` and `package-lock.json`; generated licence inventory covers both ecosystems.
