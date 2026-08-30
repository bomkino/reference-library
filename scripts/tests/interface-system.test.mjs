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
    assert.ok(problems.filter((problem) => problem.includes("prohibited visual effect")).length >= 3);
    assert.ok(problems.some((problem) => problem.includes(".facet-chip must have a min-height floor")));
    assert.ok(problems.some((problem) => problem.includes(".icon-button must have min-height and min-width floors")));
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
