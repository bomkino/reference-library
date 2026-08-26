# T01 Starting State Receipt

**Recorded:** 26 August 2026 UTC  
**Repository:** `https://github.com/bomkino/reference-library`  
**Expected and actual default branch:** `main`  
**Expected and actual start SHA:** `622237237e4492292df91b8912f9109cb3a0bf1e`  
**Expected and actual tree:** `LICENSE`, `README.md`  
**Working tree before branch creation:** clean; `main` matched `origin/main`  
**Execution branch:** `codex/reference-library-tracer-01`

## Contract verification

Uploaded archive SHA-256: `d430175db3ae064cd5e5b0a2ff748af5efe0fd018b5e87ad8bd07826b6d5a85f`.

`sha256sum -c PACKAGE_MANIFEST.sha256` passed all 671 listed entries. The package was read in its required order. GitHub connector commit search and local `git fetch` both confirmed the expected head. No reconciliation was required; no newer work existed to preserve.

## Local environment

```text
Linux 6.18.35 x86_64
Node.js v24.19.0
npm 11.9.0
Python 3.12.13
Git 2.51.1
Rust/Cargo unavailable at start
Swift unavailable at start
Clang, CMake, Ninja and sqlite3 CLI unavailable at start
```

npm uses `https://registry.npmjs.org/` through the managed environment proxy. Network access is restricted. Dependency installation therefore requires an available allowlisted/proxied registry or CI. Local tool absence is evidence about this runner, not target-platform support.

## GitHub-hosted runners available at start

GitHub's `actions/runner-images` inventory at commit `564e58dbe650c507ccba1171f6159c12f26820c8` lists `ubuntu-latest` as Ubuntu 24.04 x64 and `macos-26`/`macos-latest` as macOS 26 arm64. The workflow pins explicit labels where target architecture matters.

## Commands

```text
sha256sum -c PACKAGE_MANIFEST.sha256                         exit 0; 671/671 OK
git fetch origin                                             exit 0
git switch main                                              exit 0
git pull --ff-only                                           exit 0; already up to date
git rev-parse HEAD                                           622237237e4492292df91b8912f9109cb3a0bf1e
git status --short --branch                                  ## main...origin/main
git ls-tree -r --name-only HEAD                              LICENSE, README.md
git switch -c codex/reference-library-tracer-01              exit 0
```
