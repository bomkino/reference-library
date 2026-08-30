# Third-Party Software and Provenance

No source has been copied from the proof corpus or legacy Asset Browser. Reference Library vendors only the CC0 font binaries recorded below; it does not copy the pitch.dog Type System's separately licensed CSS, tokens, documentation, examples or artwork.

Before direct code reuse, record:

- capability and reason for reuse;
- repository and exact commit or tag;
- copied files, crates or packages;
- licence and copyright holder;
- local modifications;
- security implications and verification fixture;
- corresponding notice location.

Do not copy unknown-licence, proprietary, source-available-only, noncommercial, private, client or paid-font material. Package-manager dependencies must be exact-lockfile reproducible. `DEPENDENCY-LICENSES.json` becomes generated truth once dependency graphs exist.

## Selected direct dependencies

Current package dependencies are consumed through their public APIs; dependency source is not copied into this repository. `DEPENDENCY-LICENSES.json` and `THIRD_PARTY-NOTICES.txt` are generated authority for the complete locked shipped graphs.

| Package | Version | Licence | Purpose | Source |
|---|---:|---|---|---|
| `@phosphor-icons/react` | 2.1.10 | MIT | Accessible, consistent shared-workspace icon components | npm / github.com/phosphor-icons/react |
| `image` | 0.25.10 | MIT OR Apache-2.0 | Bounded JPEG, PNG and WebP rendition decoding/downsampling | crates.io |
| `imagesize` | 0.15.0 | MIT | Bounded common-still dimension probe | crates.io |
| `libc` | 0.2.189 | MIT OR Apache-2.0 | No-follow descriptor-relative filesystem authority on Unix hosts | crates.io |
| `rusqlite` | 0.40.2 | MIT | SQLite canonical state; bundled SQLite feature | crates.io |
| `serde` | 1.0.229 | MIT OR Apache-2.0 | Typed protocol and manifest serialization | crates.io |
| `serde_json` | 1.0.151 | MIT OR Apache-2.0 | Framed JSON and canonical values | crates.io |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 | Quick reconciliation fingerprint | crates.io |
| `thiserror` | 2.0.20 | MIT OR Apache-2.0 | Typed internal errors | crates.io |
| `uuid` | 1.25.0 | Apache-2.0 OR MIT | Generated stable IDs and session tokens | crates.io |

Exact transitive versions live in `Cargo.lock` and `package-lock.json`; generated licence inventory covers both ecosystems.

## Bundled pitch.dog fonts

Reference Library copies the seven runtime WOFF2 binaries from [`bomkino/pitchdog-type-system` v13.0.0](https://github.com/bomkino/pitchdog-type-system/tree/v13.0.0), exact commit `786b4a2b671182319320f922b8de8f927ea3a002`. pitch.dog dedicates those font binaries to the public domain under CC0 1.0 Universal. They are copied unchanged, bundled into the application and served only from local application resources.

| File | SHA-256 |
|---|---|
| `pd-head.woff2` | `528dd6d9d5d79265f4e3589523a250cd652110d1380e87a0252bca9489da50e9` |
| `pd-head-alt.woff2` | `bf4db03493580a52e3e01cb6aec2fe791da8e7293d6083e2c567c3bb3f0b927a` |
| `pd-body-roman.woff2` | `433a1b69a8e8a903478b978c198b879824541dc9eb62db959058ae37a250819f` |
| `pd-body-italic.woff2` | `6bd35c9ad364e585ca5667c1df74f892eebbe32237005ba926b54ffa61df8a78` |
| `pd-body-alt-roman.woff2` | `4ae6044273de9010d1a9660001319c34a4a8ece764279bb7f1e0f81f01dca85b` |
| `pd-body-alt-italic.woff2` | `9f59a7f058ba824e0b3e2760204c0c70b7cfb2f61956a460b730e486b1209285` |
| `pd-eyebrow-site.woff2` | `24aeaf1bfb45a874fe807c8138fc0d815b499b1834e8291c2dc46bb5fc32b7a3` |

Upstream font licence: [CC0 1.0 Universal](https://github.com/bomkino/pitchdog-type-system/blob/v13.0.0/FONT-LICENSE.md). Runtime font downloads, GitHub authentication and client-side tokens are prohibited.
