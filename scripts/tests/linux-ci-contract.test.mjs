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
    "squashfs-tools",
    "linux-sandbox-refusal.mjs",
    "Reproduce installed Chromium sandbox ownership",
    "sudo chown root:root",
    "sudo chmod 4755",
    "0:0:4755",
    "linux-packaged-runtime-smoke.mjs",
    "--display x11",
    "weston --backend=headless-backend.so",
    "linux-wayland-observation.mjs --require-session",
    "--display wayland",
    "--timeout-ms 15000",
    "t01-semantic-roundtrip.mjs",
    "write-artifact-checksums.mjs",
    "verify-artifact-checksums.mjs",
    "--require-clean-source",
    "SHA256SUMS",
    "V1_BUILD_RECEIPT.json",
  ]) assert.match(linux, new RegExp(escapeRegExp(required)), `missing Linux CI seam: ${required}`);
  assert.doesNotMatch(linux, /T01_BUILD_RECEIPT/);
  assert.doesNotMatch(linux, /--minimum-ms/);
  assert.doesNotMatch(linux, /--no-sandbox|--disable-setuid-sandbox/);
  assert.match(linux, /actions\/upload-artifact@[0-9a-f]{40}/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
