import assert from "node:assert/strict";
import { cp, mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { assertRuntimeImportClosure } from "../scripts/build.mjs";

test("the packaged runtime contains the complete native import graph", async () => {
  const source = new URL("../src/", import.meta.url);
  const directory = await mkdtemp(path.join(os.tmpdir(), "reference-runtime-graph-"));
  try {
    await cp(source, directory, { recursive: true });
    await assertRuntimeImportClosure(directory);
    await unlink(path.join(directory, "library-recovery.mjs"));
    await assert.rejects(
      assertRuntimeImportClosure(directory),
      /main\.mjs -> library-recovery\.mjs/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("main's eight split native modules are all in the build graph", async () => {
  const expected = new Set([
    "library-open-queue.mjs",
    "library-open.mjs",
    "library-recovery.mjs",
    "permission-policy.mjs",
    "renderer-error.mjs",
    "runtime-hardening.mjs",
    "session-resource-authority.mjs",
    "workspace-preferences.mjs",
  ]);
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/main.mjs", import.meta.url), "utf8"));
  const imports = new Set([...source.matchAll(/from\s+["']\.\/([^"']+)["']/g)].map((match) => match[1]));
  assert.deepEqual(new Set([...expected].filter((name) => imports.has(name))), expected);
});
