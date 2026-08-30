import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { inspectInterfaceSystem, verifyInterfaceSystem } from "../check-interface-system.mjs";

const repository = path.resolve(import.meta.dirname, "../..");

test("the checked-in interface system satisfies the deterministic contract", async () => {
  const result = await verifyInterfaceSystem(repository);
  assert.deepEqual(result, {
    fontCount: 7,
    controlFloorCount: 24,
    phosphorVersion: "2.1.10",
  });
});

test("font bytes, local faces, roles and documented hashes cannot drift", async () => {
  await withFixture(async (fixture) => {
    const fontPath = path.join(fixture, "packages/workspace/src/fonts/pd-head.woff2");
    const font = Buffer.from(await readFile(fontPath));
    font[0] ^= 0xff;
    await writeFile(fontPath, font);

    const documentationPath = path.join(fixture, "THIRD_PARTY.md");
    const documentation = await readFile(documentationPath, "utf8");
    await writeFile(
      documentationPath,
      documentation.replace(
        "528dd6d9d5d79265f4e3589523a250cd652110d1380e87a0252bca9489da50e9",
        "0".repeat(64),
      ),
    );

    const stylesheetPath = path.join(fixture, "packages/workspace/src/styles.css");
    const stylesheet = await readFile(stylesheetPath, "utf8");
    await writeFile(
      stylesheetPath,
      stylesheet
        .replace('url("./fonts/pd-head.woff2")', 'url("https://example.test/pd-head.woff2")')
        .replace(
          '--font-body: "PD Body", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
          '--font-body: "Drifted Body", sans-serif;',
        ),
    );

    const problems = await inspectInterfaceSystem(fixture);
    assert.ok(problems.some((problem) => problem.includes("pd-head.woff2 SHA-256 drift")));
    assert.ok(problems.some((problem) => problem.includes("THIRD_PARTY.md must document pd-head.woff2")));
    assert.ok(problems.some((problem) => problem.includes("@font-face must use one local")));
    assert.ok(problems.some((problem) => problem.includes("--font-body must be")));
  });
});

test("runtime type, token spacing, effects and control floors cannot regress", async () => {
  await withFixture(async (fixture) => {
    const stylesheetPath = path.join(fixture, "packages/workspace/src/styles.css");
    const stylesheet = await readFile(stylesheetPath, "utf8");
    const withoutFloorCoverage = stylesheet
      .replace("--space-4: 1rem;", "--space-4: 13px;")
      .replace(".view-settings:not([open]) > .view-settings__panel { display: none; }", "")
      .replace(
        ".icon-button,\n.token button,\n.selection-chip__order button,",
        ".token button,\n.selection-chip__order button,",
      );
    await writeFile(
      stylesheetPath,
      `${withoutFloorCoverage}\n.contract-regression {\n  padding: 13px;\n  gap: clamp(1rem, 2vw, 2rem);\n  font-weight: 700;\n  font-variation-settings: "wght" 700;\n  background: linear-gradient(#fff, #000);\n  -webkit-mask: none;\n  backdrop-filter: blur(4px);\n}\n.facet-chip { min-height: 2rem; }\n`,
    );

    const problems = await inspectInterfaceSystem(fixture);
    assert.ok(problems.some((problem) => problem.includes("padding must use --space tokens")));
    assert.ok(problems.some((problem) => problem.includes("gap must use --space tokens")));
    assert.ok(problems.some((problem) => problem.includes("runtime font-weight 700")));
    assert.ok(problems.some((problem) => problem.includes("runtime wght axis 700")));
    assert.ok(problems.some((problem) => problem.includes("must define --space-4 once")));
    assert.ok(problems.some((problem) => problem.includes("closed view settings must explicitly hide")));
    assert.ok(problems.filter((problem) => problem.includes("prohibited visual effect")).length >= 3);
    assert.ok(problems.some((problem) => problem.includes(".facet-chip must have a min-height floor")));
    assert.ok(problems.some((problem) => problem.includes(".icon-button must have min-height and min-width floors")));
  });
});

test("icon geometry, overlay stability and bounded motion cannot regress", async () => {
  await withFixture(async (fixture) => {
    const stylesheetPath = path.join(fixture, "packages/workspace/src/styles.css");
    const stylesheet = await readFile(stylesheetPath, "utf8");
    const withoutReducedCaretMotion = stylesheet
      .replace(
        /@media \(prefers-reduced-motion: reduce\) \{\s*\.view-settings__chevron,\s*\.disclosure-icon \{ transition: none; \}\s*\}/,
        "",
      )
      .replace(
        "  .button-caret,\n  .view-settings__chevron,\n  .disclosure-icon,\n  .selection-tray__batch-caret,\n  .filter-panel,",
        "  .filter-panel,",
      );
    await writeFile(
      stylesheetPath,
      `${withoutReducedCaretMotion
        .replaceAll(/visibility\s+0s\s+[^,;]+?\s+(?:\d*\.?\d+)(?:ms|s)/g, "visibility 0s linear 0s")
        .replaceAll("transition-delay: 0s;", "transition-delay: 170ms;")}
.filter-panel { position: static; }
.ui-icon,
button > svg,
summary svg { width: 2em; height: 2em; flex: 1 1 auto; }
.button-caret,
.selection-tray__batch-caret,
.view-settings__chevron,
.disclosure-icon { inline-size: 2rem; block-size: 2rem; flex: 1 1 2rem; place-items: start; }
button,
.view-settings > summary,
.inspector__disclosure-label { gap: var(--space-1); }
.query-commandbar__filters[aria-expanded="true"] .button-caret,
.selection-tray__batch-caret--open,
.view-settings[open] .view-settings__chevron,
.inspector__disclosure[open] .disclosure-icon { transform: rotate(90deg); }
.contract-regression { transition: all 450ms ease; }
.implicit-transition-regression { transition: 200ms ease; }
@media (max-width: 1320px) {
  .sidebar,
  .inspector { visibility: visible; pointer-events: auto; }
}
`,
    );

    const wrapperPath = path.join(fixture, "packages/workspace/src/ui-icon.tsx");
    const wrapper = await readFile(wrapperPath, "utf8");
    await writeFile(wrapperPath, wrapper.replace('className="ui-icon" ', ""));

    const problems = await inspectInterfaceSystem(fixture);
    assert.ok(problems.some((problem) => problem.includes("fixed 1.15em icon box")));
    assert.ok(problems.some((problem) => problem.includes("--space-2 icon/text gap")));
    assert.ok(problems.some((problem) => problem.includes("fixed centered 1.5rem caret box")));
    assert.ok(problems.some((problem) => problem.includes("rotate its caret 180deg")));
    assert.ok(problems.some((problem) => problem.includes("disable its transition under reduced motion")));
    assert.ok(problems.some((problem) => problem.includes("filter-panel must be an absolute or fixed overlay")));
    assert.ok(problems.some((problem) => problem.includes("must remain hidden and non-interactive")));
    assert.ok(problems.some((problem) => problem.includes("delay hidden visibility")));
    assert.ok(problems.some((problem) => problem.includes("become visible immediately")));
    assert.ok(problems.some((problem) => problem.includes("transition must name exact properties")));
    assert.ok(problems.some((problem) => problem.includes("transition must name exact properties") && problem.includes("found 200ms ease")));
    assert.ok(problems.some((problem) => problem.includes("transition timing must be 300ms or less")));
    assert.ok(problems.some((problem) => problem.includes("UiIcon must expose the shared ui-icon class")));
  });
});

test("the Phosphor pin, decorative wrapper and glyph ban cannot regress", async () => {
  await withFixture(async (fixture) => {
    const packagePath = path.join(fixture, "packages/workspace/package.json");
    const workspacePackage = JSON.parse(await readFile(packagePath, "utf8"));
    workspacePackage.dependencies["@phosphor-icons/react"] = "^2.1.10";
    await writeFile(packagePath, `${JSON.stringify(workspacePackage, null, 2)}\n`);

    const lockfilePath = path.join(fixture, "package-lock.json");
    const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
    lockfile.packages["packages/workspace"].dependencies["@phosphor-icons/react"] = "^2.1.10";
    lockfile.packages["node_modules/@phosphor-icons/react"].version = "2.1.9";
    await writeFile(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);

    const wrapperPath = path.join(fixture, "packages/workspace/src/ui-icon.tsx");
    const wrapper = await readFile(wrapperPath, "utf8");
    await writeFile(
      wrapperPath,
      wrapper.replace('weight="bold"', 'weight="regular"').replace('focusable="false"', 'focusable="true"'),
    );

    const mainPath = path.join(fixture, "packages/workspace/src/main.tsx");
    const main = await readFile(mainPath, "utf8");
    await writeFile(
      mainPath,
      `${main}\nexport const contractRegression = <span style={{ gap: "13px", fontWeight: 700 }}>×</span>;\n`,
    );

    const problems = await inspectInterfaceSystem(fixture);
    assert.ok(problems.some((problem) => problem.includes("pin @phosphor-icons/react exactly")));
    assert.ok(problems.some((problem) => problem.includes("package-lock.json must resolve")));
    assert.ok(problems.some((problem) => problem.includes("UiIcon must use the bold icon weight")));
    assert.ok(problems.some((problem) => problem.includes("UiIcon must make decorative icons unfocusable")));
    assert.ok(problems.some((problem) => problem.includes("main.tsx contains utility glyph")));
    assert.ok(problems.some((problem) => problem.includes("inline gap must use --space tokens")));
    assert.ok(problems.some((problem) => problem.includes("inline fontWeight 700")));
  });
});

async function withFixture(assertion) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "reference-interface-system-"));
  try {
    for (const relative of [
      "THIRD_PARTY.md",
      "package-lock.json",
      "packages/workspace/package.json",
      "packages/workspace/src",
    ]) {
      const destination = path.join(fixture, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(repository, relative), destination, { recursive: true });
    }
    await assertion(fixture);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}
