import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const TARGETS = Object.freeze({
  "linux-x86_64": { os: "linux", arch: "x86_64" },
  "macos-arm64": { os: "macos", arch: "arm64" },
});

export async function createArtifactReceipt({ sourceCommit, targetName, artifactPaths }) {
  assertSourceCommit(sourceCommit);
  const target = TARGETS[targetName];
  if (!target) throw new Error(`Unsupported artifact target: ${targetName}`);
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    throw new Error("At least one artifact is required");
  }

  const artifacts = [];
  const names = new Set();
  for (const artifactPath of artifactPaths) {
    const absolutePath = path.resolve(artifactPath);
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Artifact must be a regular non-symlink file: ${artifactPath}`);
    }
    const file = path.basename(absolutePath);
    if (names.has(file)) throw new Error(`Duplicate artifact filename: ${file}`);
    names.add(file);
    artifacts.push({
      file,
      bytes: metadata.size,
      sha256: await sha256File(absolutePath),
    });
  }
  artifacts.sort((left, right) => left.file.localeCompare(right.file));

  return {
    schemaVersion: 1,
    evidenceScope: "packaged_in_compatible_environment",
    sourceCommit,
    target,
    artifacts,
    claimExclusions: ["installed", "target_integrated", "released"],
  };
}

export async function verifyArtifactReceipt(receiptPath, { requireCurrentTarget = false } = {}) {
  const absoluteReceipt = path.resolve(receiptPath);
  const receipt = JSON.parse(await readFile(absoluteReceipt, "utf8"));
  if (receipt?.schemaVersion !== 1) throw new Error("Unsupported artifact receipt schema");
  if (receipt?.evidenceScope !== "packaged_in_compatible_environment") {
    throw new Error("Artifact receipt overstates or omits its evidence scope");
  }
  assertSourceCommit(receipt.sourceCommit);
  assertTarget(receipt.target);
  if (requireCurrentTarget) assertCurrentTarget(receipt.target);
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) {
    throw new Error("Artifact receipt contains no artifacts");
  }
  if (
    !Array.isArray(receipt.claimExclusions) ||
    !["installed", "target_integrated", "released"].every((value) =>
      receipt.claimExclusions.includes(value),
    )
  ) {
    throw new Error("Artifact receipt must retain install, integration, and release exclusions");
  }

  const receiptDirectory = path.dirname(absoluteReceipt);
  const names = new Set();
  for (const artifact of receipt.artifacts) {
    if (
      typeof artifact?.file !== "string" ||
      artifact.file !== path.basename(artifact.file) ||
      artifact.file === "." ||
      artifact.file === ".." ||
      names.has(artifact.file)
    ) {
      throw new Error("Artifact receipt contains an unsafe or duplicate filename");
    }
    names.add(artifact.file);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) {
      throw new Error(`Invalid artifact size: ${artifact.file}`);
    }
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      throw new Error(`Invalid artifact SHA-256: ${artifact.file}`);
    }
    const artifactPath = path.join(receiptDirectory, artifact.file);
    const metadata = await lstat(artifactPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Artifact is not a regular non-symlink file: ${artifact.file}`);
    }
    if (metadata.size !== artifact.bytes) throw new Error(`Artifact size mismatch: ${artifact.file}`);
    const observedHash = await sha256File(artifactPath);
    if (observedHash !== artifact.sha256) throw new Error(`Artifact hash mismatch: ${artifact.file}`);
  }

  return {
    status: "verified_build_artifacts",
    sourceCommit: receipt.sourceCommit,
    target: receipt.target,
    artifactCount: receipt.artifacts.length,
  };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function assertSourceCommit(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("sourceCommit must be a full lowercase Git SHA");
  }
}

function assertTarget(value) {
  if (
    !value ||
    !Object.values(TARGETS).some(
      (target) => target.os === value.os && target.arch === value.arch,
    )
  ) {
    throw new Error("Unsupported artifact receipt target");
  }
}

function assertCurrentTarget(target) {
  const currentOS = process.platform === "darwin" ? "macos" : process.platform;
  const currentArch = process.arch === "x64" ? "x86_64" : process.arch;
  if (target.os !== currentOS || target.arch !== currentArch) {
    throw new Error(
      `Artifact target ${target.os}-${target.arch} does not match ${currentOS}-${currentArch}`,
    );
  }
}
