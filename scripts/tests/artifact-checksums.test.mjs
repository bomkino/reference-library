import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createArtifactChecksumManifest,
  verifyArtifactChecksumManifest,
} from "../artifact-checksums.mjs";

const sourceTree = { state: "clean", commit: "a".repeat(40), tree: "b".repeat(40) };
const releaseIdentity = {
  version: "0.1.0",
  bundleIdentifier: "io.pitchdog.ReferenceLibrary",
  metadataSha256: "c".repeat(64),
};

test("checksums bind regular artifact bytes to source tree and metadata", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-checksums-"));
  try {
    const artifact = path.join(temporary, "reference-library.tar.gz");
    const manifest = path.join(temporary, "SHA256SUMS");
    await writeFile(artifact, "exact bytes");
    await writeFile(manifest, await createArtifactChecksumManifest({
      sourceTree,
      releaseIdentity,
      targetName: "linux-x86_64",
      artifactPaths: [artifact],
    }));
    const verified = await verifyArtifactChecksumManifest(manifest);
    assert.equal(verified.sourceCommit, sourceTree.commit);
    assert.equal(verified.sourceTree, sourceTree.tree);
    assert.equal(verified.artifacts.size, 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("checksum verification rejects drift", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-checksum-drift-"));
  try {
    const artifact = path.join(temporary, "reference-library.tar.gz");
    const manifest = path.join(temporary, "SHA256SUMS");
    await writeFile(artifact, "first bytes");
    await writeFile(manifest, await createArtifactChecksumManifest({
      sourceTree,
      releaseIdentity,
      targetName: "linux-x86_64",
      artifactPaths: [artifact],
    }));
    await writeFile(artifact, "changed bytes");
    await assert.rejects(verifyArtifactChecksumManifest(manifest), /checksum mismatch/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
