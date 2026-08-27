#!/usr/bin/env node
import path from "node:path";

import { verifyReleaseMetadata } from "./release-metadata.mjs";

const repository = path.resolve(import.meta.dirname, "..");
const metadata = await verifyReleaseMetadata(repository);
process.stdout.write(
  `release metadata OK: ${metadata.productName} ${metadata.version} (${metadata.buildNumber})\n`,
);
