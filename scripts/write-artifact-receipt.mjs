#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { createArtifactReceipt } from "./artifact-receipt.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: "string" },
    target: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.source || !values.target || !values.output || positionals.length === 0) {
  throw new Error(
    "Usage: write-artifact-receipt --source <full-sha> --target <linux-x86_64|macos-arm64> --output <receipt.json> <artifact...>",
  );
}

const output = path.resolve(values.output);
const receipt = await createArtifactReceipt({
  sourceCommit: values.source,
  targetName: values.target,
  artifactPaths: positionals,
});
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${output}\n`);
