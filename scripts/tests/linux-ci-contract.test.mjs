import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repository = path.resolve(import.meta.dirname, "../..");

test("Ubuntu package CI extracts every format and rehearses hardened X11 and Wayland runtime", async () => {
  const workflow = await readFile(path.join(repository, ".github/workflows/ci.yml"), "utf8");
  const linux = workflow.match(/  linux-package-directory:[\s\S]*?\n  macos-arm64-package:/)?.[0];
  assert.ok(linux, "Linux package job is missing");
  for (const required of [
    "linux-artifact-contract.mjs",
    "linux-sandbox-refusal.mjs",
    "linux-packaged-runtime-smoke.mjs",
    "--display x11",
    "weston --backend=headless-backend.so",
    "linux-wayland-observation.mjs --require-session",
    "--display wayland",
    "t01-semantic-roundtrip.mjs",
    "write-artifact-checksums.mjs",
    "verify-artifact-checksums.mjs",
    "--require-clean-source",
    "SHA256SUMS",
  ]) assert.match(linux, new RegExp(escapeRegExp(required)), `missing Linux CI seam: ${required}`);
  assert.doesNotMatch(linux, /--no-sandbox|--disable-setuid-sandbox/);
  assert.match(linux, /actions\/upload-artifact@[0-9a-f]{40}/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
