# T02 Standards Review

**Review date:** 27 August 2026 UTC  
**Reviewed remote source:** `3a55385afd21b32f2e7bb80a8b83661348e8d6b5`  
**Reviewed tree:** `e6bfa93a528804e2498153f01bfedc2ff2f88f55`

## Verdict

No Critical or High source-level defect was found in the T02 delta. The implementation remains narrow, reversible and subordinate to the accepted identity and security boundaries.

## Ownership and module depth

- `reference-core::discovery` alone owns filesystem observation, evidence evaluation and transactional reconciliation.
- SQLite continues to own canonical Source/Location/Asset relationships. Platform evidence never crosses into the workspace contract or canonical dump.
- The workspace owns only presentation continuity: it refreshes loaded summaries by stable Asset ID and renders Missing explicitly.
- The supervised protocol adds a truthful feature advertisement but no new command or renderer authority.

The public seam was designed twice. Filename/fingerprint matching was rejected in favor of strict unique host identity plus revision corroboration; a new reconcile command was rejected in favor of the existing authorized Root scan.

## Identity and failure safety

- Device and inode are stored as opaque reconciliation evidence, not generated IDs.
- A single-link predicate prevents a known multi-occurrence file from being collapsed into one Location.
- The old stored path must return `NotFound`; permission errors, symlinks and other states do not authorize relocation.
- Current Revision size and quick fingerprint must corroborate the host file ID, reducing inode-reuse risk.
- Every decision occurs inside the existing scan transaction. The temporary `moved_candidate` state is not externally visible.
- If the predicate fails, no merge or destructive repair occurs. The old Asset remains Missing and the new observation receives generated IDs.

## Security and privacy

- SQL remains parameterized.
- Directory symlinks remain skipped. Stored relative paths are rejected for absolute, parent, root and prefix components before absence checks.
- No native path, device/inode value or fingerprint enters renderer state, URLs or bridge results.
- Opaque resource authorization and named Location reveal continue to resolve through the privileged core.
- Source mutation, network access, accounts, telemetry and AI remain absent.

## Engineering checks

| Area | Fresh result |
|---|---|
| Rust format and lint | `cargo fmt --all -- --check`; Clippy workspace/all-targets with warnings denied: pass |
| Rust public seams | 12 tests pass, including 3 T02 identity fixtures and the 100,000-Asset window |
| Workspace/Linux source | TypeScript, 6 workspace tests, 8 Linux tests and production builds pass |
| Semantic parity | 3 Assets; stable Library ID; semantic diff 0 |
| Dependency audit | npm full and production audits: 0 vulnerabilities |
| Provenance | deterministic inventory: 473 packages; no Rust duplicate tree |
| Repository boundary | 10 required files; no proof corpus or legacy browser |
| Compatible Linux packaging | pacman, AppImage and tar assembled; executable/core/ASAR and archive paths verified |

## Performance and accessibility

The scanner adds fixed-size file identity metadata and one indexed-by-scope reconciliation query only for a previously unseen path. It retains 32-item commits, cancellation points and bounded UI paging. No whole-catalogue serialization or rendering was added. Selection semantics and text Missing states remain keyboard- and assistive-technology-readable; real VoiceOver, Orca and compositor behavior remain M1/L1.

## Limitations

- Migration 1 does not index platform file identity. T02 is deliberately narrow; a future measured large-corpus regression may justify an index, but no speculative schema migration was added.
- Platform identity is implemented for Unix targets. Unsupported hosts fail closed into Missing plus a separate observation.
- The compatible Linux package still uses the known placeholder icon. This is packaging polish, not identity correctness.
- Exact Apple-Silicon build and target behavior require CI/M1 evidence respectively.

## Conclusion

The implementation prefers recoverable false negatives over corrupting false positives, keeps platform evidence outside shared document meaning, and introduces no new privileged seam. No standards repair is required before exact-head CI and receipt closure.

## Exact-source CI follow-up

GitHub Actions run `33040429601` passed repository, Rust, workspace/Linux source, Linux package and Apple-Silicon package jobs at review/receipt source `39c1a20f9ee1ef04af1774b69368dbe0d0ee8362`. Source-bound receipts and archive checks passed. **Finding:** no new Critical or High defect; compatible packaging is proved, target installation is not.
