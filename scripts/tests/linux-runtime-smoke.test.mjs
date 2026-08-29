import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  assertPackagedJourneyObservation,
  observeSustainedProcess,
  requestCleanWindowClose,
} from "../linux-packaged-runtime-smoke.mjs";
import { observeWaylandSession } from "../linux-wayland-observation.mjs";
import {
  assertNavigationGuardBehavior,
  assertPackagedRendererBoundary,
  validatePackagedRendererBoundary,
} from "../linux-sandbox-refusal.mjs";

const repository = path.resolve(import.meta.dirname, "../..");

test("runtime smoke distinguishes a sustained process from an early package failure", async () => {
  const sustained = await observeSustainedProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    minimumRuntimeMs: 300,
  });
  assert.equal(sustained.status, "packaged_process_sustained");
  await assert.rejects(
    observeSustainedProcess({
      command: process.execPath,
      args: ["-e", "process.stderr.write('boot failed'); process.exit(9)"],
      minimumRuntimeMs: 300,
    }),
    /exited before 300ms.*code=9/s,
  );
});

test("packaged journey requires workspace, bridge, host preferences, Core, and clean close inputs", () => {
  const observation = {
    url: "pitchdog-ui://app/index.html",
    readyState: "complete",
    heading: "Your project’s visual memory.",
    bridgeVersion: 4,
    preferences: { interfaceScale: 1, thumbnailDensity: 220, previewZoom: 1, viewMode: "grid", multiThumbnailPreviews: false, autoRescan: false },
    capabilities: [
      { name: "common-stills", state: "required_parity", reason: null },
      { name: "source-mutation", state: "intentionally_absent", reason: "outside V1" },
    ],
  };
  assert.deepEqual(assertPackagedJourneyObservation(observation), observation);
  assert.throws(() => assertPackagedJourneyObservation({ ...observation, bridgeVersion: 2 }));
  assert.throws(() => assertPackagedJourneyObservation({ ...observation, capabilities: [] }));
  assert.throws(() => assertPackagedJourneyObservation({ ...observation, url: "file:///tmp/index.html" }));
});

test("packaged journey acknowledges the close request before closing its DevTools renderer", async () => {
  const commands = [];
  const result = await requestCleanWindowClose({
    async send(method, params) {
      commands.push({ method, params });
      return { result: { value: true } };
    },
  });
  assert.equal(result, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].method, "Runtime.evaluate");
  assert.match(commands[0].params.expression, /setTimeout\(\(\) => window\.close\(\), 250\)/);
  assert.doesNotMatch(commands[0].params.expression, /window\.close\(\), 0\)/);
});

test("Wayland observation proves a compositor socket rather than environment labels alone", async () => {
  const environment = { XDG_RUNTIME_DIR: "/runtime", WAYLAND_DISPLAY: "wayland-test" };
  const result = await observeWaylandSession({
    environment,
    requireSession: true,
    inspectSocket: async () => ({ isSocket: () => true }),
  });
  assert.equal(result.connected, true);
  await assert.rejects(
    observeWaylandSession({
      environment,
      requireSession: true,
      inspectSocket: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    }),
    /socket is unavailable/,
  );
});

test("packaged renderer boundary rejects sandbox bypasses and generic IPC", () => {
  const main = `
    import { installNavigationGuards } from "./runtime-hardening.mjs";
    const win = new BrowserWindow({ webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false
    }});
    installNavigationGuards(win.webContents, trusted);
    const header = "Content-Security-Policy default-src 'none'; connect-src 'none'";
  `;
  const preload = `
    const { contextBridge, ipcRenderer } = require("electron");
    contextBridge.exposeInMainWorld("referenceLibrary", {
      openLibrary: () => ipcRenderer.invoke("reference-library:open")
    });
  `;
  const hardening = `
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    webContents.on("will-navigate", deny);
    webContents.on("will-attach-webview", deny);
  `;
  assert.doesNotThrow(() => assertPackagedRendererBoundary({ main, preload, hardening }));
  assert.throws(
    () => assertPackagedRendererBoundary({ main: `${main}\n--no-sandbox`, preload, hardening }),
    /--no-sandbox/,
  );
  assert.throws(
    () => assertPackagedRendererBoundary({ main, preload: `${preload}\nipcRenderer.send("anything")`, hardening }),
  );
  assert.throws(() => assertPackagedRendererBoundary({ main, preload, hardening: "" }));
  assert.throws(() => assertNavigationGuardBehavior(() => {}));
});

test("extracted package validation loads and exercises the bundled hardening module", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-renderer-boundary-"));
  const distribution = path.join(temporary, "dist");
  try {
    await mkdir(distribution);
    await Promise.all(["main.mjs", "runtime-hardening.mjs"].map((name) =>
      cp(path.join(repository, "apps/linux/src", name), path.join(distribution, name))));
    await writeFile(path.join(distribution, "preload.cjs"), `
      const { contextBridge, ipcRenderer } = require("electron");
      contextBridge.exposeInMainWorld("referenceLibrary", {
        openLibrary: () => ipcRenderer.invoke("reference-library:open")
      });
    `);
    const result = await validatePackagedRendererBoundary(temporary);
    assert.equal(result.status, "packaged_renderer_boundary_verified");
    await unlink(path.join(distribution, "runtime-hardening.mjs"));
    await assert.rejects(validatePackagedRendererBoundary(temporary), { code: "ENOENT" });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
