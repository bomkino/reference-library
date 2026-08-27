#!/usr/bin/env node
import { parseArgs } from "node:util";

import { verifyArtifactChecksumManifest } from "./artifact-checksums.mjs";
import { inspectCleanSource } from "./source-tree.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { repository: { type: "string" }, "require-clean-source": { type: "boolean" } },
});
if (positionals.length !== 1) throw new Error("Usage: verify-artifact-checksums [--repository <git-root> --require-clean-source] <SHA256SUMS>");
const verified = await verifyArtifactChecksumManifest(positionals[0]);
if (values["require-clean-source"]) {
  if (!values.repository) throw new Error("--repository is required with --require-clean-source");
  const source = await inspectCleanSource(values.repository, verified.sourceCommit);
  if (source.tree !== verified.sourceTree) throw new Error("checksum source tree mismatch");
}
process.stdout.write(JSON.stringify({
  status: "verified_build_artifact_checksums",
  sourceCommit: verified.sourceCommit,
  target: verified.target,
  artifactCount: verified.artifacts.size,
}, null, 2) + "\n");
