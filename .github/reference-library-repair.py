from pathlib import Path
import textwrap

ROOT = Path.cwd()


def replace(path: str, old: str, new: str, expected: int = 1) -> None:
    target = ROOT / path
    text = target.read_text()
    found = text.count(old)
    if found != expected:
        raise SystemExit(f"{path}: expected {expected} replacement(s), found {found}")
    target.write_text(text.replace(old, new))


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(textwrap.dedent(content).lstrip())


replace(
    "crates/reference-core/src/server.rs",
    """            let persisted = job
                .handle
                .take()
                .and_then(|handle| handle.join().ok())
                .unwrap_or(false);
            if !persisted {
                self.jobs.insert(job_id, job);
            }
""",
    """            // A finished worker must release its in-memory capacity even when
            // writing the terminal ledger state failed. scan_root already
            // emitted CoreNeedsRestart; retaining a consumed JoinHandle would
            // make the slot impossible to reap in this process.
            if let Some(handle) = job.handle.take() {
                let _ = handle.join();
            }
""",
)
replace(
    "crates/reference-core/src/server.rs",
    "fn finished_scan_control_is_reaped_even_when_its_terminal_event_was_dropped()",
    "fn finished_scan_control_is_reaped_after_terminal_persistence_failure()",
)
replace(
    "crates/reference-core/src/server.rs",
    "handle: Some(thread::spawn(|| true)),",
    "handle: Some(thread::spawn(|| false)),",
)

replace(
    "packages/workspace/src/app.tsx",
    """    }).catch((reason) => props.setShellError(messageFrom(reason)));
    return () => { active = false; };
""",
    """    }).catch((reason) => {
      if (active) props.setShellError(messageFrom(reason));
    });
    return () => { active = false; };
""",
)

replace(
    "packages/workspace/src/app.keyboard.integration.test.tsx",
    """  type WorkspaceEvent,
} from "@pitchdog/reference-bridge";
""",
    """  type WorkspaceEvent,
  type WorkspacePreferences,
} from "@pitchdog/reference-bridge";
""",
)
replace(
    "packages/workspace/src/app.keyboard.integration.test.tsx",
    """const SESSION: SessionOpened = { sessionId: "session-1", libraryId: "library-1", schemaVersion: 1, name: "Film References" };
const ASSETS: AssetSummary[] = [
""",
    """const SESSION: SessionOpened = { sessionId: "session-1", libraryId: "library-1", schemaVersion: 1, name: "Film References" };
const PREFERENCES: WorkspacePreferences = { interfaceScale: 1, thumbnailDensity: 220, previewZoom: 1 };
const ASSETS: AssetSummary[] = [
""",
)
replace(
    "packages/workspace/src/app.keyboard.integration.test.tsx",
    """  it("renames and confirms Collection deletion with Enter and Escape", async () => {
""",
    """  it("ignores a stale preference rejection after a Library replacement", async () => {
    let rejectStalePreferences!: (reason: unknown) => void;
    harness.preferenceReads.push(
      new Promise<WorkspacePreferences>((_resolve, reject) => {
        rejectStalePreferences = reject;
      }),
      Promise.resolve(PREFERENCES),
    );

    await focusAndPress(button("New Library"), "Enter");
    await waitFor(() => expect(text()).toContain("Film References"));
    await act(async () => {
      harness.emit({
        event: "library_opened",
        value: {
          ...SESSION,
          sessionId: "session-replacement",
          libraryId: "library-replacement",
          name: "Replacement Library",
        },
      });
      await settle();
    });
    await waitFor(() => expect(text()).toContain("Replacement Library"));
    await act(async () => {
      rejectStalePreferences(new Error("stale preference read failed"));
      await settle();
    });
    expect(host.querySelector(".error-banner")).toBeNull();
  });

  it("renames and confirms Collection deletion with Enter and Escape", async () => {
""",
)
replace(
    "packages/workspace/src/app.keyboard.integration.test.tsx",
    """  queryGate: Promise<void> | null = null;
""",
    """  preferenceReads: Array<Promise<WorkspacePreferences>> = [];
  queryGate: Promise<void> | null = null;
""",
)
replace(
    "packages/workspace/src/app.keyboard.integration.test.tsx",
    """    readPreferences: async () => ({ interfaceScale: 1, thumbnailDensity: 220, previewZoom: 1 }),
""",
    """    readPreferences: async () => this.preferenceReads.shift() ?? PREFERENCES,
""",
)

replace(
    ".github/workflows/ci.yml",
    """on:
  push:
    branches: [main, "codex/**"]
  pull_request:

permissions:
""",
    """on:
  push:
    branches: [main, "codex/**"]
  pull_request:
  workflow_dispatch:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}

permissions:
""",
)
replace(
    ".github/workflows/ci.yml",
    """  repository-boundary:
    runs-on: ubuntu-24.04
""",
    """  repository-boundary:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
""",
)
replace(
    ".github/workflows/ci.yml",
    """  rust-core:
    runs-on: ubuntu-24.04
""",
    """  rust-core:
    runs-on: ubuntu-24.04
    timeout-minutes: 45
""",
)
replace(
    ".github/workflows/ci.yml",
    """  workspace-and-linux-source:
    runs-on: ubuntu-24.04
""",
    """  workspace-and-linux-source:
    runs-on: ubuntu-24.04
    timeout-minutes: 45
""",
)
replace(
    ".github/workflows/ci.yml",
    """  linux-package-directory:
    runs-on: ubuntu-24.04
""",
    """  linux-package-directory:
    runs-on: ubuntu-24.04
    timeout-minutes: 75
""",
)
replace(
    ".github/workflows/ci.yml",
    """  macos-arm64-package:
    runs-on: macos-26
""",
    """  macos-arm64-package:
    runs-on: macos-26
    timeout-minutes: 60
""",
)
replace(
    ".github/workflows/ci.yml",
    """          node-version: 24
          cache: npm
""",
    """          node-version-file: ".node-version"
          cache: npm
""",
    expected=3,
)
rust_action = "      - uses: dtolnay/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c"
replace(
    ".github/workflows/ci.yml",
    rust_action + "\n        with:\n          components: rustfmt, clippy\n",
    rust_action + "\n        with:\n          toolchain: \"1.90.0\"\n          components: rustfmt, clippy\n",
)
replace(
    ".github/workflows/ci.yml",
    rust_action + "\n        with:\n          targets: aarch64-apple-darwin\n",
    rust_action + "\n        with:\n          toolchain: \"1.90.0\"\n          targets: aarch64-apple-darwin\n",
)
replace(
    ".github/workflows/ci.yml",
    rust_action + "\n      - run: npm ci --ignore-scripts\n",
    rust_action + "\n        with:\n          toolchain: \"1.90.0\"\n      - run: npm ci --ignore-scripts\n",
)
replace(
    ".github/workflows/ci.yml",
    rust_action + "\n      - run: >-\n",
    rust_action + "\n        with:\n          toolchain: \"1.90.0\"\n      - run: >-\n",
)

write(".node-version", "24\n")
write(
    "rust-toolchain.toml",
    """
    [toolchain]
    channel = "1.90.0"
    components = ["clippy", "rustfmt"]
    profile = "minimal"
    """,
)

write(
    "scripts/check_repository.py",
    '''
    #!/usr/bin/env python3
    """Verify repository boundaries and pinned toolchain consistency."""

    from pathlib import Path
    import json
    import sys
    import tomllib


    ROOT = Path(__file__).resolve().parents[1]
    REQUIRED = (
        ".github/workflows/ci.yml",
        ".node-version",
        "rust-toolchain.toml",
        "package.json",
        "package-lock.json",
        "Cargo.toml",
        "Cargo.lock",
        "README.md",
        "AGENTS.md",
        "CONTEXT.md",
        "LICENSE",
        "NOTICE",
        "THIRD_PARTY.md",
        "DEPENDENCY-LICENSES.json",
        "THIRD_PARTY-NOTICES.txt",
        "assets/branding/reference-library-icon.svg",
        "assets/branding/reference-library-icon-1024.png",
        "apps/macos/ReferenceLibrary.entitlements",
        "apps/macos/ReferenceCore.entitlements",
        "docs/maintenance/REPOSITORY_MAINTENANCE.md",
        "docs/product/PRODUCT_CONSTITUTION.md",
        "docs/specs/TRACER_T01.md",
        "docs/security/SECURITY_MODEL.md",
        "docs/evidence/DECISION_EVIDENCE_LOG.md",
    )
    FORBIDDEN_DIRS = ("06_EXECUTABLE_PROOF_PROGRAMME", "asset-browser")
    EXPECTED_NODE_MAJOR = "24"


    def main() -> int:
        problems: list[str] = []
        problems.extend(
            f"missing required file: {path}"
            for path in REQUIRED
            if not (ROOT / path).is_file()
        )
        problems.extend(
            f"forbidden imported corpus: {path}"
            for path in FORBIDDEN_DIRS
            if (ROOT / path).exists()
        )

        try:
            dependency_licences = json.loads(
                (ROOT / "DEPENDENCY-LICENSES.json").read_text()
            )
            if dependency_licences.get("schemaVersion") != 2:
                problems.append(
                    "DEPENDENCY-LICENSES.json has unsupported schemaVersion"
                )
        except (OSError, json.JSONDecodeError) as error:
            problems.append(f"cannot read DEPENDENCY-LICENSES.json: {error}")

        try:
            cargo = tomllib.loads((ROOT / "Cargo.toml").read_text())
            rust_version = cargo["workspace"]["package"]["rust-version"]
            expected_rust_channel = f"{rust_version}.0"
            toolchain = tomllib.loads(
                (ROOT / "rust-toolchain.toml").read_text()
            )["toolchain"]
            if toolchain.get("channel") != expected_rust_channel:
                problems.append(
                    "rust-toolchain.toml channel must match Cargo.toml rust-version"
                )
            components = set(toolchain.get("components", []))
            if not {"clippy", "rustfmt"}.issubset(components):
                problems.append(
                    "rust-toolchain.toml must install clippy and rustfmt"
                )
        except (OSError, KeyError, TypeError, tomllib.TOMLDecodeError) as error:
            problems.append(f"cannot verify Rust toolchain metadata: {error}")
            expected_rust_channel = None

        try:
            node_major = (ROOT / ".node-version").read_text().strip()
            if node_major != EXPECTED_NODE_MAJOR:
                problems.append(
                    f".node-version must be {EXPECTED_NODE_MAJOR}, found {node_major!r}"
                )
        except OSError as error:
            problems.append(f"cannot read .node-version: {error}")

        try:
            workflow = (ROOT / ".github/workflows/ci.yml").read_text()
            if workflow.count('node-version-file: ".node-version"') != 3:
                problems.append(
                    "CI must use .node-version in all three Node jobs"
                )
            rust_actions = workflow.count("uses: dtolnay/rust-toolchain@")
            if expected_rust_channel and workflow.count(
                f'toolchain: "{expected_rust_channel}"'
            ) != rust_actions:
                problems.append(
                    "every CI Rust action must use the pinned workspace toolchain"
                )
            if workflow.count("timeout-minutes:") != 5:
                problems.append("every CI job must have a timeout")
            if "cancel-in-progress:" not in workflow:
                problems.append("CI must define concurrency cancellation")
        except OSError as error:
            problems.append(f"cannot read CI workflow: {error}")

        if problems:
            for problem in problems:
                print(problem, file=sys.stderr)
            return 1

        print(
            f"repository boundary OK: {len(REQUIRED)} required files; "
            "toolchains pinned; no forbidden corpus"
        )
        return 0


    if __name__ == "__main__":
        raise SystemExit(main())
    ''',
)

write(
    "README.md",
    '''
    # Reference Library

    [![CI](https://github.com/bomkino/reference-library/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bomkino/reference-library/actions/workflows/ci.yml)

    Reference Library is a project-specific, local-first visual research and source-organising application for pitch-deck work. It has no account, telemetry, cloud dependency or embedded AI.

    One project gets one `.pitchlibrary` package. Apple-Silicon macOS is primary. Garuda Linux / Arch / KDE is the binding Linux target. Both editions share canonical document meaning.

    ## Status

    V1 is **source-ready and canonical on `main`**. The five-job CI workflow verifies repository boundaries, Rust protocol/Core behavior, shared workspace and Linux source, extracted Linux packages under X11 and headless Wayland, and the ad-hoc-signed Apple-Silicon app ZIP.

    Source-ready is not target-integrated. Representative Apple Silicon and Jenai's Garuda system still need the M1, L1, X1 and C1 journeys. No tag or public GitHub release exists.

    Exact historical evidence lives in the [V1 main-integration receipt](docs/evidence/V1_MAIN_INTEGRATION_RECEIPT.md) and [V1 source-ready receipt](docs/evidence/V1_SOURCE_READY_RECEIPT.md). The latest successful `main` workflow is the current source evidence; CI artifacts are not releases.

    ## V1 scope

    - project-local `.pitchlibrary` package
    - authorized Root add, reconnect and rescan
    - stable Asset identity across supported external renames
    - bounded still-image thumbnails and previews
    - manual review, title and note curation
    - lexical query, filters, sorting and flat Collections
    - native reveal and opaque resource delivery
    - bounded cross-host canonical proof

    Excerpts, similarity, duplicate review, source mutation, broad professional formats, nested or smart Collections, tags, ratings, saved searches, MCP and automatic updates remain deferred.

    ## Repository map

    - `crates/`: shared Rust protocol and Core
    - `packages/`: shared bridge contract and editorial workspace
    - `apps/`: native platform shells
    - `migrations/`: canonical SQLite migrations
    - `scripts/`: verification, packaging and evidence tools
    - `docs/`: product, architecture, security, maintenance and receipts
    - `fixtures/`: tiny committed fixtures; large fixtures are generated

    Read `AGENTS.md`, `CONTEXT.md` and `docs/specs/V1_EXECUTION_CONTRACT.md` before changing source.

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

    `cargo audit` is also mandatory in CI through pinned `cargo-audit` 0.22.2. macOS source verification adds `swift test --package-path apps/macos`.

    See [repository maintenance](docs/maintenance/REPOSITORY_MAINTENANCE.md) for package gates, evidence rules and branch cleanup.

    ## Licence

    GNU Affero General Public License v3.0. See `LICENSE`.
    ''',
)

write(
    "AGENTS.md",
    '''
    # Repository Instructions

    Read `CONTEXT.md`, `docs/product/PRODUCT_CONSTITUTION.md`, `docs/specs/TRACER_T01.md`, `docs/security/SECURITY_MODEL.md`, `docs/maintenance/REPOSITORY_MAINTENANCE.md` and relevant ADRs before modifying source.

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

    ## Toolchains

    Use Node 24 from `.node-version` and Rust 1.90.0 from `rust-toolchain.toml`. Do not silently advance either pin. Update the pin, CI, dependency evidence and documentation together.

    ## Required source verification

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

    CI additionally runs pinned RustSec auditing, exact Linux package extraction and runtime rehearsals, checksum/receipt verification, Swift tests and Apple-Silicon app packaging. Run `swift test --package-path apps/macos` on compatible macOS source changes.

    A green compatible runner proves source-ready behavior only. M1, L1, X1 and C1 remain separate target-machine gates.
    ''',
)

write(
    "docs/maintenance/REPOSITORY_MAINTENANCE.md",
    '''
    # Repository Maintenance

    This file describes how Reference Library stays reproducible, reviewable and honest after V1 source closure.

    ## Canonical state

    `main` is the only canonical branch. Work happens on short-lived branches. Merge only after the exact branch head passes the complete required workflow. Delete merged branches when the available GitHub interface permits it; never preserve a branch merely as informal release evidence.

    No tag or GitHub release should exist until the relevant packaged journey has passed on representative Apple Silicon and Garuda/KDE hardware. Workflow artifacts are retained build evidence, not public releases.

    ## Toolchain policy

    - `.node-version` pins the Node major used locally and by every Node CI job.
    - `rust-toolchain.toml` pins Rust, Clippy and rustfmt.
    - `Cargo.toml` `rust-version`, the Rust toolchain file and all CI Rust actions must agree.
    - Toolchain movement is an explicit maintenance change. Run the full matrix and regenerate dependency/licence evidence when dependency resolution changes.

    `scripts/check_repository.py` enforces these relationships and the repository boundary.

    ## Required workflow jobs

    | Job | Evidence |
    | --- | --- |
    | `repository-boundary` | required files, product icon and release metadata |
    | `rust-core` | RustSec audit, format, Clippy, Core tests and semantic round trips |
    | `workspace-and-linux-source` | npm audit, type checks, shared/Linux tests, builds and legal bundle |
    | `linux-package-directory` | pacman/AppImage/tar assembly, extraction, sandbox refusal, X11/Wayland rehearsals, checksums and receipt |
    | `macos-arm64-package` | Swift tests, app build, extraction, ad-hoc signature, checksums and receipt |

    Every job has a hard timeout. Superseded branch runs cancel automatically; `main` runs do not.

    ## Claim boundaries

    - **Source-ready:** source and available CI pass at an exact revision.
    - **Packaged in a compatible runner:** an artifact assembled and passed its declared runner checks.
    - **Target-integrated:** the installed journey passed on representative target hardware.
    - **Released:** a deliberate tag and public release exist.

    Never collapse these terms. A compatible Ubuntu or macOS runner cannot close M1, L1, X1 or C1 by itself.

    ## Evidence and receipts

    Append decisions to `docs/evidence/DECISION_EVIDENCE_LOG.md`; do not rewrite prior entries. Exact-source receipts may link immutable commits, workflow runs, artifact IDs and checksums. Prefer dynamic `main` status in general documentation so a maintenance commit does not leave a stale “latest” SHA behind.

    Generated package artifacts belong in workflow storage, not Git history. Keep large proof corpora and client assets out of the repository.

    ## Public hygiene

    Do not put a client `.pitchlibrary`, original media, private filesystem paths, unredacted logs or screenshots into public issues. Reduce failures to synthetic fixtures. Keep issues and branches tied to actionable work; close or remove obsolete scaffolding after integration.
    ''',
)

evidence = ROOT / "docs/evidence/DECISION_EVIDENCE_LOG.md"
heading = "## 2026-08-28 — Repository lifecycle and CI hardening"
if heading in evidence.read_text():
    raise SystemExit("decision evidence entry already exists")
with evidence.open("a") as handle:
    handle.write(
        "\n\n" + heading + "\n\n"
        "**Hypothesis:** completed worker controls and ambient toolchain drift can leave source behavior correct while leaking runtime capacity or making later evidence irreproducible.\n\n"
        "**Change:** release every finished scan control even when terminal ledger persistence fails; ignore preference-read failures after their workspace unmounts; add focused regressions; pin Node and Rust; bind CI to those pins; add concurrency cancellation, job timeouts, stronger repository checks and maintenance documentation.\n\n"
        "**Fresh measurement:** the repair bootstrap passed the expanded repository-boundary check and `git diff --check`. Full Rust, Node, Linux-package and macOS-package evidence remains required on the exact branch head before integration.\n\n"
        "**Decision:** keep the narrow lifecycle and maintenance repairs only if the complete five-job workflow passes. Preserve the existing source-ready/target-integrated distinction; M1, L1, X1 and C1 remain open.\n"
    )
