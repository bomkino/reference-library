import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

export async function createArtifactChecksumManifest({
  sourceTree,
  releaseIdentity,
  targetName,
  artifactPaths,
}) {
  assertSourceTree(sourceTree);
  assertReleaseIdentity(releaseIdentity);
  assert.match(targetName, /^(linux-x86_64|macos-arm64)$/);
  const artifacts = await inspectArtifacts(artifactPaths);
  return [
    "# Reference Library artifact checksums v1",
    `# sourceCommit ${sourceTree.commit}`,
    `# sourceTree ${sourceTree.tree}`,
    `# releaseVersion ${releaseIdentity.version}`,
    `# releaseMetadataSha256 ${releaseIdentity.metadataSha256}`,
    `# target ${targetName}`,
    ...artifacts.map((artifact) => `${artifact.sha256}  ${artifact.file}`),
    "",
  ].join("\n");
}

export async function verifyArtifactChecksumManifest(manifestPath) {
  const absolute = path.resolve(manifestPath);
  const lines = (await readFile(absolute, "utf8")).split("\n");
  const header = Object.fromEntries(
    lines
      .filter((line) => line.startsWith("# ") && line !== "# Reference Library artifact checksums v1")
      .map((line) => {
        const separator = line.indexOf(" ", 2);
        return [line.slice(2, separator), line.slice(separator + 1)];
      }),
  );
  assert.match(header.sourceCommit ?? "", /^[0-9a-f]{40}$/);
  assert.match(header.sourceTree ?? "", /^[0-9a-f]{40}$/);
  assert.match(header.releaseVersion ?? "", /^\d+\.\d+\.\d+$/);
  assert.match(header.releaseMetadataSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.match(header.target ?? "", /^(linux-x86_64|macos-arm64)$/);
  const artifacts = new Map();
  for (const line of lines.filter((value) => value && !value.startsWith("#"))) {
    const match = /^([0-9a-f]{64})  ([^/\\]+)$/.exec(line);
    if (!match || match[2] === "." || match[2] === ".." || artifacts.has(match[2])) {
      throw new Error("checksum manifest contains an unsafe or duplicate entry");
    }
    const artifactPath = path.join(path.dirname(absolute), match[2]);
    const metadata = await lstat(artifactPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`checksum target is not a regular file: ${match[2]}`);
    }
    const observed = await sha256File(artifactPath);
    if (observed !== match[1]) throw new Error(`artifact checksum mismatch: ${match[2]}`);
    artifacts.set(match[2], observed);
  }
  if (artifacts.size === 0) throw new Error("checksum manifest contains no artifacts");
  return { ...header, artifacts };
}

export async function inspectArtifacts(artifactPaths) {
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    throw new Error("at least one artifact is required");
  }
  const names = new Set();
  const artifacts = [];
  for (const artifactPath of artifactPaths) {
    const absolute = path.resolve(artifactPath);
    const metadata = await lstat(absolute);
    const file = path.basename(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`artifact must be a regular non-symlink file: ${artifactPath}`);
    }
    if (names.has(file)) throw new Error(`duplicate artifact filename: ${file}`);
    names.add(file);
    artifacts.push({ file, bytes: metadata.size, sha256: await sha256File(absolute) });
  }
  return artifacts.sort((left, right) => left.file.localeCompare(right.file));
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export function assertSourceTree(sourceTree) {
  assert.equal(sourceTree?.state, "clean");
  assert.match(sourceTree?.commit ?? "", /^[0-9a-f]{40}$/);
  assert.match(sourceTree?.tree ?? "", /^[0-9a-f]{40}$/);
}

export function assertReleaseIdentity(releaseIdentity) {
  assert.match(releaseIdentity?.version ?? "", /^\d+\.\d+\.\d+$/);
  assert.match(releaseIdentity?.bundleIdentifier ?? "", /^[A-Za-z0-9.-]+$/);
  assert.match(releaseIdentity?.metadataSha256 ?? "", /^[0-9a-f]{64}$/);
}
