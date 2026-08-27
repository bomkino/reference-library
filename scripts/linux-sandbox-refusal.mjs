#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export function assertPackagedRendererBoundary({ main, preload, hardening }) {
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /allowRunningInsecureContent:\s*false/);
  assert.match(main, /import\s*\{[^}]*installNavigationGuards[^}]*\}\s*from\s*["']\.\/runtime-hardening\.mjs["']/s);
  assert.match(main, /installNavigationGuards\s*\(/);
  assert.match(main, /Content-Security-Policy/);
  assert.match(main, /default-src 'none'/);
  assert.match(main, /connect-src 'none'/);
  assert.doesNotMatch(main, /--no-sandbox|disableSandbox|sandbox:\s*false/);
  assert.doesNotMatch(preload, /ipcRenderer\.(?:send|sendSync|postMessage)\s*\(/);
  const requiredModules = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)]
    .map((match) => match[1]);
  assert.ok(requiredModules.length > 0, "sandbox preload must load Electron explicitly");
  assert.deepEqual(new Set(requiredModules), new Set(["electron"]));
  assert.doesNotMatch(preload, /node:fs|node:child_process/);
  assert.doesNotMatch(preload, /(?:^|[;\n])\s*import\s/m);
  assert.match(preload, /contextBridge\.exposeInMainWorld\(["']referenceLibrary["']/);
  assert.equal(typeof hardening, "string");
  assert.match(hardening, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*["']deny["']/);
  assert.match(hardening, /will-navigate/);
  assert.match(hardening, /will-attach-webview/);
}

export function assertNavigationGuardBehavior(installNavigationGuards) {
  assert.equal(typeof installNavigationGuards, "function");
  const handlers = new Map();
  let windowHandler;
  const webContents = {
    setWindowOpenHandler: (handler) => { windowHandler = handler; },
    on: (name, handler) => handlers.set(name, handler),
  };
  installNavigationGuards(webContents, (url) => url === "pitchdog-ui://app/index.html");
  assert.deepEqual(windowHandler?.(), { action: "deny" });
  let untrustedPrevented = 0;
  handlers.get("will-navigate")?.(
    { preventDefault: () => { untrustedPrevented += 1; } },
    "https://example.test",
  );
  assert.equal(untrustedPrevented, 1);
  let trustedPrevented = 0;
  handlers.get("will-navigate")?.(
    { preventDefault: () => { trustedPrevented += 1; } },
    "pitchdog-ui://app/index.html",
  );
  assert.equal(trustedPrevented, 0);
  let webviewPrevented = 0;
  handlers.get("will-attach-webview")?.({ preventDefault: () => { webviewPrevented += 1; } });
  assert.equal(webviewPrevented, 1);
}

export async function validatePackagedRendererBoundary(asarDirectory) {
  const mainPath = path.join(asarDirectory, "dist/main.mjs");
  const preloadPath = path.join(asarDirectory, "dist/preload.cjs");
  const hardeningPath = path.join(asarDirectory, "dist/runtime-hardening.mjs");
  const [main, preload, hardening] = await Promise.all([
    readFile(mainPath, "utf8"),
    readFile(preloadPath, "utf8"),
    readFile(hardeningPath, "utf8"),
  ]);
  assertPackagedRendererBoundary({ main, preload, hardening });
  const module = await import(`${pathToFileURL(hardeningPath).href}?renderer-boundary=${Date.now()}`);
  assertNavigationGuardBehavior(module.installNavigationGuards);
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
