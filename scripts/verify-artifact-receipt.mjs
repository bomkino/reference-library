#!/usr/bin/env node
import { parseArgs } from "node:util";

import { verifyArtifactReceipt } from "./artifact-receipt.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "require-current-target": { type: "boolean", default: false },
  },
});
if (positionals.length !== 1) {
  throw new Error(
    "Usage: verify-artifact-receipt [--require-current-target] <receipt.json>",
  );
}
const result = await verifyArtifactReceipt(positionals[0], {
  requireCurrentTarget: values["require-current-target"],
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
