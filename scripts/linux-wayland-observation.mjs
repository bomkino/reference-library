#!/usr/bin/env node
import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export async function observeWaylandSession({
  environment = process.env,
  requireSession = false,
  inspectSocket = lstat,
}) {
  const runtimeDirectory = environment.XDG_RUNTIME_DIR ?? null;
  const display = environment.WAYLAND_DISPLAY ?? null;
  let socket = null;
  let connected = false;
  if (runtimeDirectory && display && path.basename(display) === display) {
    socket = path.join(runtimeDirectory, display);
    try {
      connected = (await inspectSocket(socket)).isSocket();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (requireSession) {
    assert.ok(runtimeDirectory, "XDG_RUNTIME_DIR is missing");
    assert.ok(display, "WAYLAND_DISPLAY is missing");
    assert.ok(connected, "Wayland compositor socket is unavailable");
  }
  return {
    schemaVersion: 1,
    evidenceScope: "compatible_ubuntu_wayland_session",
    runtimeDirectory,
    display,
    socket,
    connected,
    claimExclusions: ["garuda_integrated", "kde_integrated", "released"],
  };
}

const invoked = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const { values } = parseArgs({
    options: { "require-session": { type: "boolean", default: false } },
  });
  const result = await observeWaylandSession({ requireSession: values["require-session"] });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
