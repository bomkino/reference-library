#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MAX_CAPTURE_BYTES = 256 * 1024;
const FATAL_SANDBOX = /No usable sandbox|SUID sandbox helper binary.*not configured|Running as root without --no-sandbox|FATAL:.*sandbox/i;

export async function observeSustainedProcess({
  command,
  args = [],
  env = process.env,
  minimumRuntimeMs = 4_000,
}) {
  assert.ok(Number.isSafeInteger(minimumRuntimeMs) && minimumRuntimeMs >= 250);
  const child = spawn(command, args, {
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const append = (current, chunk) =>
    `${current}${chunk.toString("utf8")}`.slice(-MAX_CAPTURE_BYTES);
  child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });

  const earlyExit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let survived = false;
  try {
    const outcome = await Promise.race([
      earlyExit,
      new Promise((resolve) => setTimeout(() => resolve(null), minimumRuntimeMs)),
    ]);
    if (outcome) {
      throw new Error(
        `packaged application exited before ${minimumRuntimeMs}ms ` +
        `(code=${outcome.code}, signal=${outcome.signal})\n${stderr}`,
      );
    }
    survived = true;
    assert.doesNotMatch(`${stdout}\n${stderr}`, FATAL_SANDBOX);
    return {
      status: "packaged_process_sustained",
      minimumRuntimeMs,
      stdout,
      stderr,
    };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      await Promise.race([
        earlyExit,
        new Promise((resolve) => setTimeout(resolve, survived ? 2_000 : 250)),
      ]);
    }
  }
}

export async function smokePackagedLinuxApplication({ application, display, minimumRuntimeMs }) {
  if (process.platform !== "linux") throw new Error("Linux runtime smoke requires Linux");
  let command = application;
  let args = [];
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: "1" };
  if (display === "x11") {
    command = "xvfb-run";
    args = ["-a", application];
  } else if (display === "wayland") {
    if (!env.XDG_RUNTIME_DIR || !env.WAYLAND_DISPLAY) {
      throw new Error("Wayland smoke requires XDG_RUNTIME_DIR and WAYLAND_DISPLAY");
    }
    args = ["--ozone-platform=wayland", "--enable-features=UseOzonePlatform"];
  } else {
    throw new Error(`Unsupported display rehearsal: ${display}`);
  }
  const observation = await observeSustainedProcess({
    command,
    args,
    env,
    minimumRuntimeMs,
  });
  return {
    status: "packaged_runtime_rehearsed",
    evidenceScope: "compatible_ubuntu_environment",
    display,
    minimumRuntimeMs: observation.minimumRuntimeMs,
    claimExclusions: ["garuda_integrated", "kde_integrated", "released"],
  };
}

const invoked = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const { values } = parseArgs({
    options: {
      application: { type: "string" },
      display: { type: "string", default: "x11" },
      "minimum-ms": { type: "string", default: "4000" },
    },
  });
  if (!values.application) throw new Error("--application is required");
  const minimumRuntimeMs = Number(values["minimum-ms"]);
  const result = await smokePackagedLinuxApplication({
    application: path.resolve(values.application),
    display: values.display,
    minimumRuntimeMs,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
