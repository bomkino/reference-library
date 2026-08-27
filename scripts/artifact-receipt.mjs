import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  assertReleaseIdentity,
  assertSourceTree,
  inspectArtifacts,
  sha256File,
  verifyArtifactChecksumManifest,
} from "./artifact-checksums.mjs";

const TARGETS = Object.freeze({
  "linux-x86_64": { name: "linux-x86_64", os: "linux", arch: "x86_64" },
  "macos-arm64": { name: "macos-arm64", os: "macos", arch: "arm64" },
});

export async function createArtifactReceipt({
  sourceTree,
  releaseIdentity,
  targetName,
  artifactPaths,
  checksumManifestPath,
}) {
  assertSourceTree(sourceTree);
  assertReleaseIdentity(releaseIdentity);
  const target = TARGETS[targetName];
  if (!target) throw new Error(`Unsupported artifact target: ${targetName}`);
  const artifacts = await inspectArtifacts(artifactPaths);
  const checksumManifest = await verifyArtifactChecksumManifest(checksumManifestPath);
  assert.equal(checksumManifest.sourceCommit, sourceTree.commit);
  assert.equal(checksumManifest.sourceTree, sourceTree.tree);
  assert.equal(checksumManifest.releaseVersion, releaseIdentity.version);
  assert.equal(checksumManifest.releaseMetadataSha256, releaseIdentity.metadataSha256);
  assert.equal(checksumManifest.target, targetName);
  assert.deepEqual(
    [...checksumManifest.artifacts.entries()].sort(),
    artifacts.map((artifact) => [artifact.file, artifact.sha256]).sort(),
  );
  return {
    schemaVersion: 2,
    evidenceScope: "packaged_in_compatible_environment",
    sourceTree,
    releaseIdentity,
    target,
    checksumManifest: {
      file: path.basename(checksumManifestPath),
      sha256: await sha256File(checksumManifestPath),
    },
    artifacts,
    claimExclusions: ["installed", "target_integrated", "released"],
  };
}

export async function verifyArtifactReceipt(receiptPath, { requireCurrentTarget = false } = {}) {
  const absoluteReceipt = path.resolve(receiptPath);
  const receipt = JSON.parse(await readFile(absoluteReceipt, "utf8"));
  assert.equal(receipt?.schemaVersion, 2, "unsupported artifact receipt schema");
  assert.equal(
    receipt?.evidenceScope,
    "packaged_in_compatible_environment",
    "artifact receipt overstates or omits its evidence scope",
  );
  assertSourceTree(receipt.sourceTree);
  assertReleaseIdentity(receipt.releaseIdentity);
  assertTarget(receipt.target);
  if (requireCurrentTarget) assertCurrentTarget(receipt.target);
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) {
    throw new Error("artifact receipt contains no artifacts");
  }
  if (
    !Array.isArray(receipt.claimExclusions) ||
    !["installed", "target_integrated", "released"].every((value) =>
      receipt.claimExclusions.includes(value))
  ) {
    throw new Error("artifact receipt must retain install, integration, and release exclusions");
  }
  const receiptDirectory = path.dirname(absoluteReceipt);
  const checksumPath = safeSibling(receiptDirectory, receipt.checksumManifest?.file);
  if (await sha256File(checksumPath) !== receipt.checksumManifest?.sha256) {
    throw new Error("checksum manifest hash mismatch");
  }
  const checksums = await verifyArtifactChecksumManifest(checksumPath);
  assert.equal(checksums.sourceCommit, receipt.sourceTree.commit);
  assert.equal(checksums.sourceTree, receipt.sourceTree.tree);
  assert.equal(checksums.releaseMetadataSha256, receipt.releaseIdentity.metadataSha256);
  assert.equal(checksums.target, receipt.target.name);

  const names = new Set();
  for (const artifact of receipt.artifacts) {
    const artifactPath = safeSibling(receiptDirectory, artifact?.file);
    if (names.has(artifact.file)) throw new Error("artifact receipt contains a duplicate filename");
    names.add(artifact.file);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) {
      throw new Error(`invalid artifact size: ${artifact.file}`);
    }
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      throw new Error(`invalid artifact SHA-256: ${artifact.file}`);
    }
    const metadata = await lstat(artifactPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`artifact is not a regular non-symlink file: ${artifact.file}`);
    }
    if (metadata.size !== artifact.bytes) throw new Error(`artifact size mismatch: ${artifact.file}`);
    const observedHash = await sha256File(artifactPath);
    if (observedHash !== artifact.sha256 || checksums.artifacts.get(artifact.file) !== observedHash) {
      throw new Error(`artifact hash mismatch: ${artifact.file}`);
    }
  }
  if (checksums.artifacts.size !== names.size) throw new Error("checksum artifact set mismatch");
  return {
    status: "verified_build_artifacts",
    sourceCommit: receipt.sourceTree.commit,
    sourceTree: receipt.sourceTree.tree,
    releaseVersion: receipt.releaseIdentity.version,
    target: receipt.target,
    artifactCount: receipt.artifacts.length,
  };
}

function safeSibling(directory, file) {
  if (
    typeof file !== "string" ||
    file !== path.basename(file) ||
    file === "." ||
    file === ".."
  ) {
    throw new Error("artifact receipt contains an unsafe filename");
  }
  return path.join(directory, file);
}

function assertTarget(value) {
  assert.ok(
    value && Object.values(TARGETS).some((target) =>
      target.name === value.name && target.os === value.os && target.arch === value.arch),
    "unsupported artifact receipt target",
  );
}

function assertCurrentTarget(target) {
  const currentOS = process.platform === "darwin" ? "macos" : process.platform;
  const currentArch = process.arch === "x64" ? "x86_64" : process.arch;
  if (target.os !== currentOS || target.arch !== currentArch) {
    throw new Error(
      `artifact target ${target.os}-${target.arch} does not match ${currentOS}-${currentArch}`,
    );
  }
}
