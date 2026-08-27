import assert from "node:assert/strict";
import { test } from "node:test";

import { observeSustainedProcess } from "../linux-packaged-runtime-smoke.mjs";
import { observeWaylandSession } from "../linux-wayland-observation.mjs";
import { assertPackagedRendererBoundary } from "../linux-sandbox-refusal.mjs";

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
    const win = new BrowserWindow({ webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false
    }});
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", deny);
    const header = "Content-Security-Policy default-src 'none'; connect-src 'none'";
  `;
  const preload = `
    contextBridge.exposeInMainWorld("referenceLibrary", {
      openLibrary: () => ipcRenderer.invoke("reference-library:open")
    });
  `;
  assert.doesNotThrow(() => assertPackagedRendererBoundary({ main, preload }));
  assert.throws(
    () => assertPackagedRendererBoundary({ main: `${main}\n--no-sandbox`, preload }),
    /--no-sandbox/,
  );
  assert.throws(
    () => assertPackagedRendererBoundary({ main, preload: `${preload}\nipcRenderer.send("anything")` }),
  );
});
