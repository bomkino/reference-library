from pathlib import Path
import json
import re

VERSION = "0.2.0"
BUILD = "2"
RELEASE_DATE = "2026-08-29"


def write_json(path: str, value: object) -> None:
    Path(path).write_text(json.dumps(value, indent=2) + "\n")


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old!r}")
    file.write_text(source.replace(old, new, 1))


package_paths = [
    "package.json",
    "apps/linux/package.json",
    "packages/bridge-contract/package.json",
    "packages/workspace/package.json",
]
for path in package_paths:
    package = json.loads(Path(path).read_text())
    package["version"] = VERSION
    if path == "packages/workspace/package.json":
        package["dependencies"]["@pitchdog/reference-bridge"] = VERSION
    write_json(path, package)

replace_once(
    "Cargo.toml",
    '[workspace.package]\nversion = "0.1.0"',
    f'[workspace.package]\nversion = "{VERSION}"',
)
replace_once("apps/linux/packaging/PKGBUILD", "pkgver=0.1.0", f"pkgver={VERSION}")
replace_once(
    "apps/macos/Info.plist",
    "<key>CFBundleShortVersionString</key><string>0.1.0</string>",
    f"<key>CFBundleShortVersionString</key><string>{VERSION}</string>",
)
replace_once(
    "apps/macos/Info.plist",
    "<key>CFBundleVersion</key><string>1</string>",
    f"<key>CFBundleVersion</key><string>{BUILD}</string>",
)

metadata = json.loads(Path("release-metadata.json").read_text())
metadata["version"] = VERSION
metadata["buildNumber"] = BUILD
metadata["targets"]["linux-x86_64"]["artifacts"] = [
    f"reference-library-{VERSION}-x64.pacman",
    f"reference-library-{VERSION}-x86_64.AppImage",
    f"reference-library-{VERSION}-x64.tar.gz",
]
metadata["targets"]["macos-arm64"]["artifacts"] = [
    f"reference-library-{VERSION}-macos-arm64.app.zip"
]
write_json("release-metadata.json", metadata)

ci = Path(".github/workflows/ci.yml")
ci_source = ci.read_text()
observed = ci_source.count("0.1.0")
if observed < 10:
    raise SystemExit(f"CI version surface unexpectedly small: {observed}")
ci.write_text(ci_source.replace("0.1.0", VERSION))

Path("README.md").write_text(f"""# Reference Library

[![CI](https://github.com/bomkino/reference-library/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bomkino/reference-library/actions/workflows/ci.yml)

Reference Library is a project-specific, local-first visual research and source-organising application for pitch-deck work. It has no account, telemetry, cloud dependency or embedded AI.

One project gets one `.pitchlibrary` package. Apple-Silicon macOS is primary. Garuda Linux / Arch / KDE is the binding Linux target. Both editions share canonical document meaning.

## Status

**{VERSION} is the current public release.** It restores the useful breadth of the original Pitch Deck Tools Asset Browser, adds a deliberate shortlist-and-compare decision loop, and completes the responsive editorial UI/UX journey.

Release binaries are built from exact `main`, validated by the five-job CI matrix, and published with SHA-256 checksums and source-bound build receipts. Representative Apple-Silicon, Garuda/KDE and Mac → Garuda → Mac target-machine journeys remain open evidence gates; the release does not falsely claim those integrations.

See [Asset Browser parity](docs/product/ASSET_BROWSER_PARITY.md), [Editorial Shortlist and Compare](docs/product/EDITORIAL_SHORTLIST_AND_COMPARE.md), the [feature-parity execution contract](docs/specs/FEATURE_PARITY_EXECUTION_CONTRACT.md), and the [0.2.0 release receipt](docs/evidence/RELEASE_0.2.0.md).

## Download and install

Download {VERSION} from [GitHub Releases](https://github.com/bomkino/reference-library/releases/latest). Verify the downloaded file against `SHA256SUMS` from the same release before opening it.

### Apple-Silicon macOS

1. Download `reference-library-{VERSION}-macos-arm64.app.zip` and expand it.
2. Move `Reference Library.app` to `/Applications`.
3. On first launch, Control-click the app in Finder and choose **Open**. If macOS still blocks it, use **System Settings → Privacy & Security → Open Anyway**.

The app is ad-hoc signed but not notarized because this project does not use a paid Apple Developer membership. Do not disable Gatekeeper or clear quarantine globally; approve this exact app instead.

### Linux x86_64

- AppImage: make `reference-library-{VERSION}-x86_64.AppImage` executable, then run it.
- Arch/Garuda: install `reference-library-{VERSION}-x64.pacman` with `sudo pacman -U`.
- Portable fallback: expand `reference-library-{VERSION}-x64.tar.gz` and run the bundled executable.

Ubuntu CI validates the packages and packaged X11/Wayland journeys. This is compatible-runner evidence, not a claim that representative Garuda/KDE hardware integration is complete.

## What 0.2.0 adds

### Broad, honest catalogue

- common images, design files, documents, video, audio, fonts and archives
- Grid, Compact and List browsing
- optional related-thumbnail mosaics
- category, extension, media-family, Tag, Used In, Root, review, availability and Collection facets
- name, date, review-state and file-size sorting
- native Open Original, Reveal Source and Copy Path without exposing absolute paths to the embedded workspace
- opt-in 60-second Root rescanning
- durable Tags and Used In provenance

Catalogue support and preview support remain separate. Material without a trusted renderer stays visible, searchable, curatable, openable and revealable as catalogue-only; it is never silently dropped or falsely presented as damaged.

### Editorial decision loop

- bounded 32-Asset Shortlist across filters and paging
- ordered first-four Compare slots
- four-up Compare Board with shared zoom and optional synchronized pan
- review, Tags and Used In context while comparing
- per-candidate Keep, Maybe, Reject, Open, Reveal and Copy Path
- batch review, Tags, Used In and Collection membership
- rapid review shortcuts: `1` Keep, `2` Maybe, `3` Reject, `0` Clear, `X` Shortlist, `C` Compare
- revision-safe writes with conflict-aware partial results

### Interface and journey

- clearer first-run and empty states
- stronger hierarchy and quieter editorial chrome
- responsive Inspector and narrow-window drawer behaviour
- preserved focus, keyboard order and modal isolation
- larger touch targets and independent Interface Scale, thumbnail density and Preview zoom
- reduced-motion support and visual regression coverage across desktop and narrow layouts

## Core model

- project-local `.pitchlibrary` package
- authorized Root add, reconnect, rescan and optional automatic reconciliation
- stable Asset identity across supported external renames
- durable review, title, note, Tags, Used In and flat Collections
- private opaque preview delivery
- bounded cross-host canonical proof

Source mutation, similarity, duplicate review, nested or smart Collections, ratings, saved searches, MCP and automatic application updates remain deferred.

## Repository map

- `crates/`: shared Rust protocol and Core
- `packages/`: shared bridge contract and editorial workspace
- `apps/`: native platform shells
- `migrations/`: canonical SQLite migrations
- `scripts/`: verification, packaging and evidence tools
- `docs/`: product, architecture, security, maintenance and receipts
- `fixtures/`: tiny committed fixtures; large fixtures are generated

Read `AGENTS.md`, `CONTEXT.md` and the relevant product, security and architecture documents before changing source.

## Toolchains

- Node.js 24 from `.node-version`
- Rust 1.90.0, Clippy and rustfmt from `rust-toolchain.toml`
- Python 3.11 or newer for repository and licence checks
- Swift toolchain supplied by the supported macOS/Xcode host

## Verify a source checkout

```bash
npm ci --ignore-scripts
python3 scripts/check_repository.py
node scripts/generate-product-icon.mjs --check
node scripts/check-release-metadata.mjs
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --locked -p reference-core
npm audit --audit-level=high
npm run check
node scripts/t01-semantic-roundtrip.mjs --core target/debug/reference-core
node scripts/v1-semantic-roundtrip.mjs --core target/debug/reference-core
python3 scripts/generate_dependency_licenses.py --check
node scripts/legal-bundle-contract.mjs --directory .
```

`cargo audit` is mandatory in CI through pinned `cargo-audit` 0.22.2. macOS source verification adds `swift test --package-path apps/macos`.

See [repository maintenance](docs/maintenance/REPOSITORY_MAINTENANCE.md) for package gates, evidence rules and branch cleanup.

## Licence

GNU Affero General Public License v3.0. See `LICENSE`.
""")

changelog = Path("CHANGELOG.md")
changelog_source = changelog.read_text().replace(
    "## Unreleased — 0.2 candidate",
    f"## {VERSION} — {RELEASE_DATE}",
    1,
)
interface_section = """### Interface and user journey

- Rebuilds first-run, no-Library, empty-Library, no-results, unsupported and failure states as deliberate parts of the product journey.
- Strengthens hierarchy, spacing, touch targets and editorial chrome without turning the app into a SaaS dashboard.
- Preserves the Inspector through narrow-window reflow and adds a settled responsive drawer journey.
- Tightens keyboard order, focus restoration, modal isolation, accessible labels and reduced-motion behaviour.
- Adds desktop and narrow-layout screenshot/computed-style audits, then removes the temporary audit scaffolding from the repository.

"""
marker = "### Verification repairs\n"
if marker not in changelog_source:
    raise SystemExit("CHANGELOG verification marker missing")
changelog.write_text(changelog_source.replace(marker, interface_section + marker, 1))

Path("CONTEXT.md").write_text(f"""# Reference Library Context

- **Library:** project-specific canonical `.pitchlibrary` document.
- **Root:** user-authorized folder hierarchy.
- **Source:** logical file lineage independent of current path or bytes.
- **SourceRevision:** immutable observed byte state of a Source.
- **Location:** physical current or historical occurrence on storage.
- **Asset:** stable curatable identity generated independently of path, filename and hash.
- **AssetOrigin:** whole Source or non-destructive Excerpt specification connecting Source to Asset.
- **Rendition:** disposable thumbnail, preview or proxy.
- **Job:** visible long-running work with honest progress and terminal state.
- **Interface Scale:** application UI sizing; separate from thumbnail density and media zoom.
- **Canonical proof:** deterministic bounded digest/pages excluding grants, caches and expected volatile state.
- **Source-ready:** source and compatible CI pass; target integration remains unproved.
- **Target-integrated:** exact packaged journey passed on representative target hardware.

## Current release

Reference Library {VERSION} is the canonical release on `main`. It supports broad honest cataloguing, Grid/Compact/List modes, optional related-thumbnail mosaics, Tags, Used In, category/file/media facets, file-size sorting, native Open/Reveal/Copy Path, opt-in Root rescanning, an ordered bounded Shortlist, a synchronized four-up Compare Board, rapid review shortcuts, conflict-aware batch curation and the completed responsive editorial interface journey.

Catalogue support and preview support are separate truths. A readable catalogue-only source is `unsupported`, not `unreadable`. Original sources remain in place; absolute paths remain inside native hosts.

Representative Apple-Silicon, Garuda/KDE, cross-host X1 and production-architecture C1 evidence gates remain open and must not be reported as closed merely because {VERSION} is public.

Excerpts, similarity, exact-duplicate review, source move/copy/Trash, nested/smart Collections, ratings, saved searches, MCP and automatic application updates remain intentionally deferred.
""")

receipt = Path("docs/evidence/FEATURE_PARITY_IMPLEMENTATION_RECEIPT.md")
receipt_source = receipt.read_text()
receipt_source = receipt_source.replace(
    "**Draft pull-request candidate. Compatible source and package verification passed. Not merged. Not released. Not target-integrated.**",
    f"**Implementation complete and released as {VERSION}. Compatible source and package verification passed. Target integration remains unclaimed.**",
    1,
)
receipt_source = receipt_source.replace(
    "This receipt covers `codex/reference-library-feature-parity` and draft pull request #4. It does not authorize a merge or release.",
    f"This receipt records the feature-parity, editorial-decision and source-truth work promoted through pull request #4 into release {VERSION}. Explicit merge and release authority was granted on {RELEASE_DATE}.",
    1,
)
receipt_source = receipt_source.replace(
    "## Remaining proof boundary",
    "## Known unclosed integration gates",
    1,
)
receipt_source = receipt_source.replace(
    "Before promotion, complete the real-machine journeys for:",
    f"Release {VERSION} is public with these real-machine journeys still open:",
    1,
)
receipt_source = receipt_source.replace(
    "This branch is a strong source and compatible-package candidate. It is not yet evidence that every broad catalogue format has a high-fidelity preview, that comparison ergonomics are proven in daily pitch.dog work, that the app is integrated on the target machines, or that a public release is ready.",
    f"Release {VERSION} is not evidence that every broad catalogue format has a high-fidelity preview, that comparison ergonomics are proven in sustained daily pitch.dog work, or that representative target-machine integration is complete. Those limits remain explicit release facts.",
    1,
)
receipt.write_text(receipt_source)

replace_once(
    "docs/specs/FEATURE_PARITY_EXECUTION_CONTRACT.md",
    "Do not merge or release from CI evidence alone. Promotion requires exact packaged use on representative Apple-Silicon macOS and Garuda/Arch/KDE systems, followed by one real Mac → Garuda → Mac Library journey and an explicit architecture/release decision.",
    "Compatible CI cannot close representative Apple-Silicon, Garuda/KDE, cross-host or production-architecture gates. An explicitly authorized public release may proceed with those gates open only when the release notes and receipts state the limitations plainly; release status must never be presented as target-integration evidence.",
)

Path("docs/evidence/RELEASE_0.2.0.md").write_text(f"""# Reference Library {VERSION} Release Receipt

## Authority

Merge and public-release authority was explicitly granted on {RELEASE_DATE}.

## Release contract

- Canonical branch: `main`.
- Tag: `v{VERSION}`.
- GitHub Release title: `Reference Library {VERSION}`.
- Build number: `{BUILD}`.
- Release artifacts are taken from the successful exact-`main` five-job CI run.
- The GitHub Release carries `SHA256SUMS`, target build receipts and an exact release receipt containing the source SHA and workflow run ID.
- The merged `codex/*` branch is removed after publication.

## Product scope

{VERSION} restores Asset Browser breadth, adds the bounded Shortlist and four-up Compare Board, completes rapid and batch curation, separates source availability from preview capability, and settles the responsive editorial UI/UX journey.

## Honest limits

- macOS is ad-hoc signed and not notarized;
- compatible Ubuntu CI is not representative Garuda/KDE hardware integration;
- the real Mac → Garuda → Mac Library journey remains open;
- M1, L1, X1 and C1 are not closed by release publication;
- catalogue-only formats remain visible and curatable without a fabricated preview.

The machine-generated `RELEASE_RECEIPT.json` attached to the GitHub Release is the exact source/run record.
""")

Path("docs/releases").mkdir(parents=True, exist_ok=True)
Path("docs/releases/0.2.0.md").write_text(f"""# Reference Library {VERSION}

**Your project’s visual memory—now built for choosing, not merely finding.**

{VERSION} restores the useful breadth of the original Asset Browser, preserves Reference Library’s durable local project memory, and completes the editorial decision loop:

```text
browse → shortlist → compare → decide → record
```

## Highlights

- Broad honest catalogue support across images, design files, documents, video, audio, fonts and archives.
- Grid, Compact and List modes with optional related-thumbnail mosaics.
- Category, extension, media, Tags, Used In, Root, review, availability and Collection facets.
- Native Open Original, Reveal Source and Copy Path without exposing absolute paths to the embedded workspace.
- Ordered 32-Asset Shortlist and four-up Compare Board.
- Shared Fit / 100% / 200% zoom with optional normalized synchronized pan.
- Rapid review and conflict-aware batch review, Tags, Used In and Collection membership.
- Reworked first-run, empty, unsupported, error, narrow-window and responsive Inspector journeys.
- Stronger hierarchy, larger targets, quieter chrome, reliable focus and reduced-motion support.

## Downloads

- Apple-Silicon macOS: `reference-library-{VERSION}-macos-arm64.app.zip`
- Linux x86_64: AppImage, pacman package and portable tar archive
- `SHA256SUMS`: checksums for every binary
- Source-bound build receipts and `RELEASE_RECEIPT.json`

## Install

### macOS

Expand the ZIP, move `Reference Library.app` to `/Applications`, then Control-click it and choose **Open**. The app is ad-hoc signed but not notarized. Approve this exact app through Finder or **Privacy & Security**; do not disable Gatekeeper globally.

### Linux

- AppImage: mark executable and run.
- Arch/Garuda: install the `.pacman` artifact with `sudo pacman -U`.
- Portable: expand the tar archive and run the bundled executable.

## Verification and limits

All release binaries come from the successful exact-`main` CI run and are published with SHA-256 checksums and source-bound receipts.

The release does **not** claim representative Apple-Silicon use, Garuda/KDE hardware integration, or the real Mac → Garuda → Mac round trip. Those gates remain open and are documented rather than blurred.
""")

open_expr = chr(36) + "{{"
release_workflow = """name: Release verified main

on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]

permissions:
  actions: read
  contents: write

concurrency:
  group: release-verified-main
  cancel-in-progress: false

jobs:
  publish:
    if: __OPEN__ github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    env:
      GH_TOKEN: __OPEN__ github.token }}
      SOURCE_SHA: __OPEN__ github.event.workflow_run.head_sha }}
      RUN_ID: __OPEN__ github.event.workflow_run.id }}
    steps:
      - name: Check out exact verified source
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          ref: __OPEN__ github.event.workflow_run.head_sha }}
          fetch-depth: 0

      - name: Read release metadata and guard idempotency
        id: metadata
        shell: bash
        run: |
          set -euo pipefail
          version="$(python3 -c 'import json; print(json.load(open("release-metadata.json"))["version"])')"
          tag="v$version"
          echo "version=$version" >> "$GITHUB_OUTPUT"
          echo "tag=$tag" >> "$GITHUB_OUTPUT"
          if gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
            echo "publish=false" >> "$GITHUB_OUTPUT"
            echo "Release $tag already exists; no-op."
          else
            echo "publish=true" >> "$GITHUB_OUTPUT"
          fi

      - name: Download exact verified CI artifacts
        if: steps.metadata.outputs.publish == 'true'
        shell: bash
        run: |
          set -euo pipefail
          gh run download "$RUN_ID" --repo "$GITHUB_REPOSITORY" --name "reference-library-linux-x86_64-$SOURCE_SHA" --dir release-bundle/linux
          gh run download "$RUN_ID" --repo "$GITHUB_REPOSITORY" --name "reference-library-macos-arm64-$SOURCE_SHA" --dir release-bundle/macos

      - name: Assemble release evidence
        if: steps.metadata.outputs.publish == 'true'
        shell: bash
        env:
          VERSION: __OPEN__ steps.metadata.outputs.version }}
        run: |
          set -euo pipefail
          version="$VERSION"
          linux="release-bundle/linux"
          macos="release-bundle/macos"
          for file in "$linux/reference-library-$version-x64.pacman" "$linux/reference-library-$version-x86_64.AppImage" "$linux/reference-library-$version-x64.tar.gz" "$macos/reference-library-$version-macos-arm64.app.zip"; do
            test -f "$file"
          done
          sha256sum "$linux/reference-library-$version-x64.pacman" "$linux/reference-library-$version-x86_64.AppImage" "$linux/reference-library-$version-x64.tar.gz" "$macos/reference-library-$version-macos-arm64.app.zip" | sed -E 's#release-bundle/(linux|macos)/##' > release-bundle/SHA256SUMS
          cp "$linux/V1_BUILD_RECEIPT.json" release-bundle/BUILD_RECEIPT-linux-x86_64.json
          cp "$macos/V1_BUILD_RECEIPT.json" release-bundle/BUILD_RECEIPT-macos-arm64.json
          python3 - <<'PY_RELEASE'
          import json, os
          from pathlib import Path
          payload = {
              "schemaVersion": 1,
              "version": os.environ["VERSION"],
              "tag": "v" + os.environ["VERSION"],
              "sourceSha": os.environ["SOURCE_SHA"],
              "ciRunId": int(os.environ["RUN_ID"]),
              "repository": os.environ["GITHUB_REPOSITORY"],
              "evidence": "Artifacts downloaded from the successful exact-main CI workflow run.",
              "targetIntegrationClaimed": False,
          }
          Path("release-bundle/RELEASE_RECEIPT.json").write_text(json.dumps(payload, indent=2) + "\n")
          PY_RELEASE

      - name: Publish GitHub Release
        if: steps.metadata.outputs.publish == 'true'
        shell: bash
        run: |
          set -euo pipefail
          version="__OPEN__ steps.metadata.outputs.version }}"
          tag="__OPEN__ steps.metadata.outputs.tag }}"
          gh release create "$tag" --repo "$GITHUB_REPOSITORY" --target "$SOURCE_SHA" --title "Reference Library $version" --notes-file "docs/releases/$version.md" \
            "release-bundle/linux/reference-library-$version-x64.pacman" \
            "release-bundle/linux/reference-library-$version-x86_64.AppImage" \
            "release-bundle/linux/reference-library-$version-x64.tar.gz" \
            "release-bundle/macos/reference-library-$version-macos-arm64.app.zip" \
            release-bundle/SHA256SUMS \
            release-bundle/BUILD_RECEIPT-linux-x86_64.json \
            release-bundle/BUILD_RECEIPT-macos-arm64.json \
            release-bundle/RELEASE_RECEIPT.json

      - name: Remove merged Codex branches
        if: steps.metadata.outputs.publish == 'true'
        shell: bash
        run: |
          set -euo pipefail
          git ls-remote --heads origin 'refs/heads/codex/*' | awk '{sub("refs/heads/", "", $2); print $2}' | while IFS= read -r branch; do
            test -n "$branch" || continue
            git push origin --delete "$branch"
          done
""".replace("__OPEN__", open_expr)
Path(".github/workflows/release.yml").write_text(release_workflow)

stale_patterns = [
    ("README.md", r"unmerged 0\.2|Unreleased 0\.2|current stable 0\.1\.0|candidate source"),
    ("CHANGELOG.md", r"Unreleased — 0\.2 candidate"),
    ("CONTEXT.md", r"unmerged 0\.2|stable 0\.1"),
]
for path, pattern in stale_patterns:
    if re.search(pattern, Path(path).read_text(), flags=re.IGNORECASE):
        raise SystemExit(f"stale release language remains in {path}: {pattern}")
