import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createArtifactReceipt, verifyArtifactReceipt } from "../artifact-receipt.mjs";
import { createArtifactChecksumManifest } from "../artifact-checksums.mjs";

const sourceTree = { state: "clean", commit: "a".repeat(40), tree: "b".repeat(40) };
const releaseIdentity = {
  version: "0.1.0",
  bundleIdentifier: "io.pitchdog.ReferenceLibrary",
  metadataSha256: "c".repeat(64),
};

test("artifact receipts bind exact checksummed bytes to clean source without integration claims", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-artifact-receipt-"));
  try {
    const artifact = path.join(temporary, "reference-library.tar.gz");
    const checksums = path.join(temporary, "SHA256SUMS");
    const receiptPath = path.join(temporary, "BUILD_RECEIPT.json");
    await writeFile(artifact, "exact package bytes");
    await writeFile(checksums, await createArtifactChecksumManifest({
      sourceTree,
      releaseIdentity,
      targetName: "linux-x86_64",
      artifactPaths: [artifact],
    }));
    const receipt = await createArtifactReceipt({
      sourceTree,
      releaseIdentity,
      targetName: "linux-x86_64",
      artifactPaths: [artifact],
      checksumManifestPath: checksums,
    });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    assert.deepEqual(receipt.claimExclusions, ["installed", "target_integrated", "released"]);
    assert.equal(receipt.artifacts[0].bytes, 19);
    assert.deepEqual(await verifyArtifactReceipt(receiptPath), {
      status: "verified_build_artifacts",
      sourceCommit: sourceTree.commit,
      sourceTree: sourceTree.tree,
      releaseVersion: "0.1.0",
      target: { name: "linux-x86_64", os: "linux", arch: "x86_64" },
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
    const checksums = path.join(temporary, "SHA256SUMS");
    const receiptPath = path.join(temporary, "BUILD_RECEIPT.json");
    await writeFile(artifact, "first bytes");
    await writeFile(checksums, await createArtifactChecksumManifest({
      sourceTree,
      releaseIdentity,
      targetName: "linux-x86_64",
      artifactPaths: [artifact],
    }));
    const receipt = await createArtifactReceipt({
      sourceTree,
      releaseIdentity,
      targetName: "linux-x86_64",
      artifactPaths: [artifact],
      checksumManifestPath: checksums,
    });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await writeFile(artifact, "other bytes");
    await assert.rejects(verifyArtifactReceipt(receiptPath), /checksum mismatch/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
