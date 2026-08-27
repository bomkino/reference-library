#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { createArtifactChecksumManifest, sha256File } from "./artifact-checksums.mjs";
import { verifyReleaseMetadata } from "./release-metadata.mjs";
import { inspectCleanSource } from "./source-tree.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: "string" },
    repository: { type: "string" },
    target: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.source || !values.repository || !values.target || !values.output || !positionals.length) {
  throw new Error("Usage: write-artifact-checksums --source <sha> --repository <git-root> --target <target> --output <SHA256SUMS> <artifact...>");
}
const repository = path.resolve(values.repository);
const sourceTree = await inspectCleanSource(repository, values.source);
const metadata = await verifyReleaseMetadata(repository);
const expected = [...metadata.targets[values.target].artifacts].sort();
const observed = positionals.map((file) => path.basename(file)).sort();
if (JSON.stringify(expected) !== JSON.stringify(observed)) {
  throw new Error(`artifact set does not match release metadata target ${values.target}`);
}
const metadataPath = path.join(repository, "release-metadata.json");
const releaseIdentity = {
  version: metadata.version,
  bundleIdentifier: metadata.bundleIdentifier,
  metadataSha256: await sha256File(metadataPath),
};
const manifest = await createArtifactChecksumManifest({
  sourceTree,
  releaseIdentity,
  targetName: values.target,
  artifactPaths: positionals,
});
await writeFile(path.resolve(values.output), manifest, { flag: "wx" });
process.stdout.write(`${path.resolve(values.output)}\n`);
