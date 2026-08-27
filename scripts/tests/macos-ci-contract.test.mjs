import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repository = path.resolve(import.meta.dirname, "../..");

test("Apple-Silicon package CI validates the extracted app and clean-source artifact identity", async () => {
  const workflow = await readFile(path.join(repository, ".github/workflows/ci.yml"), "utf8");
  const macos = workflow.match(/  macos-arm64-package:[\s\S]*$/)?.[0];
  assert.ok(macos, "macOS package job is missing");
  for (const required of [
    "runs-on: macos-26",
    "macos-artifact-contract.mjs",
    "--extract-root",
    "write-artifact-checksums.mjs",
    "verify-artifact-checksums.mjs",
    "--require-current-target --require-clean-source",
    "SHA256SUMS",
    "V1_BUILD_RECEIPT.json",
    "MACOS_ARTIFACT_VALIDATION.json",
    "generate-product-icon.mjs --check",
  ]) assert.match(macos, new RegExp(escapeRegExp(required)), `missing macOS CI seam: ${required}`);
  assert.doesNotMatch(macos, /T01_BUILD_RECEIPT/);
  assert.match(macos, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.doesNotMatch(macos, /notari[sz]|stapler|xcrun notarytool/i);
  const buildScript = await readFile(
    path.join(repository, "apps/macos/scripts/build-app.sh"),
    "utf8",
  );
  const helperSign = buildScript.indexOf("ReferenceCore.entitlements");
  const appSign = buildScript.indexOf("ReferenceLibrary.entitlements");
  assert.ok(helperSign >= 0 && helperSign < appSign, "nested helper must be signed before the app");
  assert.doesNotMatch(buildScript, /codesign[^\n]*--deep[^\n]*--sign/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
