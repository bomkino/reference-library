#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MAX_CAPTURE_BYTES = 256 * 1024;
const FATAL_SANDBOX = /No usable sandbox|SUID sandbox helper binary.*not configured|Running as root without --no-sandbox|FATAL:.*sandbox/i;
const DEFAULT_JOURNEY_TIMEOUT_MS = 15_000;
const CLEAN_EXIT_TIMEOUT_MS = 10_000;
const WINDOW_CLOSE_DELAY_MS = 250;

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
        `(code=${outcome.code}, signal=${outcome.signal})\n` +
        `stdout:\n${stdout}\nstderr:\n${stderr}`,
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

export async function smokePackagedLinuxApplication({ application, display, timeoutMs = DEFAULT_JOURNEY_TIMEOUT_MS }) {
  if (process.platform !== "linux") throw new Error("Linux runtime smoke requires Linux");
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 60_000);
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
  const observation = await observePackagedJourney({
    command,
    args,
    env,
    timeoutMs,
  });
  return {
    status: "packaged_runtime_journey_rehearsed",
    evidenceScope: "compatible_ubuntu_environment",
    display,
    journey: observation.journey,
    cleanExit: observation.cleanExit,
    claimExclusions: ["garuda_integrated", "kde_integrated", "released"],
  };
}

export async function observePackagedJourney({ command, args = [], env = process.env, timeoutMs = DEFAULT_JOURNEY_TIMEOUT_MS }) {
  const port = await reserveLoopbackPort();
  const child = spawn(command, [
    ...args,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
  ], {
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const append = (current, chunk) => `${current}${chunk.toString("utf8")}`.slice(-MAX_CAPTURE_BYTES);
  child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let cleanExit = false;
  try {
    const target = await waitForRendererTarget(port, child, timeoutMs);
    const client = await connectDevtools(target.webSocketDebuggerUrl, timeoutMs);
    try {
      await waitForPackagedJourneyObservation(client, timeoutMs);
      await requestCleanWindowClose(client);
    } finally {
      client.close();
    }
    const outcome = await Promise.race([
      exit,
      delay(CLEAN_EXIT_TIMEOUT_MS).then(() => null),
    ]);
    assert.ok(outcome, `packaged application did not terminate within ${CLEAN_EXIT_TIMEOUT_MS}ms after window close`);
    assert.deepEqual(outcome, { code: 0, signal: null }, "packaged application did not terminate cleanly");
    assert.doesNotMatch(`${stdout}\n${stderr}`, FATAL_SANDBOX);
    cleanExit = true;
    return {
      status: "packaged_runtime_journey_completed",
      cleanExit,
      journey: [
        "renderer_target_discovered",
        "workspace_loaded",
        "host_preferences_read",
        "core_capabilities_read",
        "window_close_requested",
        "clean_process_exit",
      ],
    };
  } catch (error) {
    const detail = `\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    throw new Error(`${error.message}${detail}`, { cause: error });
  } finally {
    if (!cleanExit && child.exitCode === null && child.signalCode === null) {
      terminateProcessGroup(child, "SIGTERM");
      const stopped = await Promise.race([exit.then(() => true, () => true), delay(2_000).then(() => false)]);
      if (!stopped && child.exitCode === null && child.signalCode === null) terminateProcessGroup(child, "SIGKILL");
    }
  }
}

export async function requestCleanWindowClose(client) {
  return evaluate(
    client,
    `setTimeout(() => window.close(), ${WINDOW_CLOSE_DELAY_MS}); true`,
    false,
  );
}

async function waitForPackagedJourneyObservation(client, timeoutMs) {
  const expression = `(async () => {
    const bridge = globalThis.referenceLibrary;
    const preferences = await bridge?.readPreferences?.();
    const capabilities = await bridge?.queryCapabilities?.();
    return {
      url: location.href,
      readyState: document.readyState,
      heading: document.querySelector("h1")?.textContent?.trim() ?? null,
      bridgeVersion: bridge?.version ?? null,
      preferences,
      capabilities,
    };
  })()`;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const observation = await evaluate(client, expression, true);
      return assertPackagedJourneyObservation(observation);
    } catch (error) {
      lastError = error;
      await delay(50);
    }
  }
  throw new Error(`packaged workspace journey did not become ready: ${lastError?.message ?? "unknown state"}`);
}

export function assertPackagedJourneyObservation(observation) {
  assert.equal(observation?.url, "pitchdog-ui://app/index.html");
  assert.ok(["interactive", "complete"].includes(observation.readyState), "workspace document did not become ready");
  assert.equal(observation.heading, "Build the visual memory for one deck.");
  assert.equal(observation.bridgeVersion, 4);
  assert.ok([0.8, 1, 1.25, 1.5].includes(observation.preferences?.interfaceScale));
  assert.ok(Number.isSafeInteger(observation.preferences?.thumbnailDensity));
  assert.ok(observation.preferences.thumbnailDensity >= 140 && observation.preferences.thumbnailDensity <= 340);
  assert.ok(Number.isFinite(observation.preferences?.previewZoom));
  assert.ok(observation.preferences.previewZoom >= 0.25 && observation.preferences.previewZoom <= 4);
  assert.ok(["grid", "compact", "list"].includes(observation.preferences?.viewMode));
  assert.equal(typeof observation.preferences?.multiThumbnailPreviews, "boolean");
  assert.equal(typeof observation.preferences?.autoRescan, "boolean");
  assert.ok(Array.isArray(observation.capabilities), "Core capability response is missing");
  assert.ok(observation.capabilities.some((item) =>
    item?.name === "common-stills" && item.state === "required_parity"));
  assert.ok(observation.capabilities.some((item) =>
    item?.name === "source-mutation" && item.state === "intentionally_absent"));
  return observation;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.ok(Number.isSafeInteger(port) && port > 0);
  return port;
}

async function waitForRendererTarget(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("packaged application exited before the renderer journey");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        const targets = await response.json();
        const target = Array.isArray(targets) && targets.find((item) =>
          item?.type === "page" && item.url === "pitchdog-ui://app/index.html" &&
          typeof item.webSocketDebuggerUrl === "string");
        if (target) return target;
      }
    } catch {
      // The loopback DevTools endpoint is not ready yet.
    }
    await delay(50);
  }
  throw new Error(`packaged workspace did not become inspectable within ${timeoutMs}ms`);
}

async function connectDevtools(url, timeoutMs) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  await Promise.race([
    new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("DevTools connection failed")), { once: true });
    }),
    delay(timeoutMs).then(() => { throw new Error("DevTools connection timed out"); }),
  ]);
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) reject(new Error(`DevTools command failed: ${message.error.message}`));
    else resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error("DevTools connection closed")); }
    pending.clear();
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools ${method} timed out`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function evaluate(client, expression, awaitPromise) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: false,
  });
  if (result.exceptionDetails) throw new Error("packaged renderer journey raised an exception");
  return result.result?.value;
}

function terminateProcessGroup(child, signal) {
  try {
    if (process.platform === "win32" || !Number.isSafeInteger(child.pid)) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const invoked = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const { values } = parseArgs({
    options: {
      application: { type: "string" },
      display: { type: "string", default: "x11" },
      "timeout-ms": { type: "string", default: String(DEFAULT_JOURNEY_TIMEOUT_MS) },
    },
  });
  if (!values.application) throw new Error("--application is required");
  const timeoutMs = Number(values["timeout-ms"]);
  const result = await smokePackagedLinuxApplication({
    application: path.resolve(values.application),
    display: values.display,
    timeoutMs,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
