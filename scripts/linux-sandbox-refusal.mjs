#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export function assertPackagedRendererBoundary({ main, preload }) {
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /allowRunningInsecureContent:\s*false/);
  assert.match(main, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*["']deny["']/);
  assert.match(main, /will-navigate/);
  assert.match(main, /Content-Security-Policy/);
  assert.match(main, /default-src 'none'/);
  assert.match(main, /connect-src 'none'/);
  assert.doesNotMatch(main, /--no-sandbox|disableSandbox|sandbox:\s*false/);
  assert.doesNotMatch(preload, /ipcRenderer\.(?:send|sendSync|postMessage)\s*\(/);
  assert.doesNotMatch(preload, /require\s*\(|node:fs|node:child_process/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\(["']referenceLibrary["']/);
}

export async function validatePackagedRendererBoundary(asarDirectory) {
  const mainPath = path.join(asarDirectory, "dist/main.mjs");
  const preloadPath = path.join(asarDirectory, "dist/preload.mjs");
  const [main, preload] = await Promise.all([
    readFile(mainPath, "utf8"),
    readFile(preloadPath, "utf8"),
  ]);
  assertPackagedRendererBoundary({ main, preload });
  return {
    status: "packaged_renderer_boundary_verified",
    evidenceScope: "packaged_static_contract",
    checks: [
      "Chromium sandbox enabled",
      "context isolation enabled",
      "Node integration disabled",
      "navigation and window creation denied",
      "restrictive CSP present",
      "preload exposes named invoke-only bridge",
      "no packaged sandbox bypass switch",
    ],
    claimExclusions: ["host_sandbox_policy_verified", "garuda_integrated"],
  };
}

const invoked = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const { values } = parseArgs({
    options: { "asar-directory": { type: "string" } },
  });
  if (!values["asar-directory"]) throw new Error("--asar-directory is required");
  const result = await validatePackagedRendererBoundary(
    path.resolve(values["asar-directory"]),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
