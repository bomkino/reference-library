import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createArtifactReceipt,
  verifyArtifactReceipt,
} from "../artifact-receipt.mjs";

const SOURCE_COMMIT = "a".repeat(40);

test("artifact receipts bind exact bytes to source without integration claims", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-artifact-receipt-"));
  try {
    const artifact = path.join(temporary, "reference-library.tar.gz");
    const receiptPath = path.join(temporary, "T01_BUILD_RECEIPT.json");
    await writeFile(artifact, "exact package bytes");
    const receipt = await createArtifactReceipt({
      sourceCommit: SOURCE_COMMIT,
      targetName: "linux-x86_64",
      artifactPaths: [artifact],
    });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    assert.deepEqual(receipt.claimExclusions, ["installed", "target_integrated", "released"]);
    assert.equal(receipt.artifacts[0].bytes, 19);
    assert.match(receipt.artifacts[0].sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(await verifyArtifactReceipt(receiptPath), {
      status: "verified_build_artifacts",
      sourceCommit: SOURCE_COMMIT,
      target: { os: "linux", arch: "x86_64" },
      artifactCount: 1,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("artifact receipt verification catches byte drift", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-artifact-drift-"));
  try {
    const artifact = path.join(temporary, "reference-library.tar.gz");
    const receiptPath = path.join(temporary, "T01_BUILD_RECEIPT.json");
    await writeFile(artifact, "first bytes");
    const receipt = await createArtifactReceipt({
      sourceCommit: SOURCE_COMMIT,
      targetName: "linux-x86_64",
      artifactPaths: [artifact],
    });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await writeFile(artifact, "other bytes");
    await assert.rejects(verifyArtifactReceipt(receiptPath), /mismatch/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
