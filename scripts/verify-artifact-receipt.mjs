#!/usr/bin/env node
import { parseArgs } from "node:util";

import { verifyArtifactReceipt } from "./artifact-receipt.mjs";
import { inspectCleanSource } from "./source-tree.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "require-current-target": { type: "boolean", default: false },
    "require-clean-source": { type: "boolean", default: false },
    repository: { type: "string" },
  },
});
if (positionals.length !== 1) {
  throw new Error("Usage: verify-artifact-receipt [--require-current-target] [--require-clean-source --repository <git-root>] <receipt.json>");
}
const result = await verifyArtifactReceipt(positionals[0], {
  requireCurrentTarget: values["require-current-target"],
});
if (values["require-clean-source"]) {
  if (!values.repository) throw new Error("--repository is required with --require-clean-source");
  const source = await inspectCleanSource(values.repository, result.sourceCommit);
  if (source.tree !== result.sourceTree) throw new Error("receipt source tree mismatch");
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
