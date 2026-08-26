import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 1024 * 1024;

export class CoreSupervisor extends EventEmitter {
  #child = null;
  #buffer = Buffer.alloc(0);
  #pending = new Map();
  #stopping = false;
  #corePath;
  #clientName;
  #enableTestCommands;

  constructor({
    corePath,
    clientName = "garuda-electron",
    enableTestCommands = false,
  } = {}) {
    super();
    this.#corePath = corePath ?? resolveCorePath();
    this.#clientName = clientName;
    this.#enableTestCommands = enableTestCommands;
  }

  get running() {
    return this.#child !== null;
  }

  async start() {
    if (this.#child) return;
    this.#stopping = false;
    const child = spawn(this.#corePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: sanitizedEnvironment(this.#enableTestCommands),
      windowsHide: true,
    });
    this.#child = child;
    child.stdout.on("data", (chunk) => this.#receive(chunk));
    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) this.emit("diagnostic", message.slice(0, 2048));
    });
    child.once("error", (error) => this.#handleExit(error));
    child.once("exit", (code, signal) => {
      if (!this.#stopping) {
        this.#handleExit(new Error(`Reference Core exited (${code ?? signal ?? "unknown"})`));
      }
    });
    await this.request({
      method: "hello",
      params: { clientName: this.#clientName, supportedVersions: [PROTOCOL_VERSION] },
    });
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  async stop() {
    const child = this.#child;
    if (!child) return;
    this.#stopping = true;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try {
      await this.request({ method: "shutdown" }, 2_000);
    } catch {
      child.kill("SIGTERM");
    }
    if (child.exitCode === null) {
      const didExit = await Promise.race([
        exited.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      if (!didExit && child.exitCode === null) {
        child.kill("SIGTERM");
        await exited;
      }
    }
    this.#child = null;
    this.#stopping = false;
  }

  request(command, timeoutMs = 30_000) {
    const child = this.#child;
    if (!child?.stdin.writable) {
      return Promise.reject(new Error("Reference Core is not running"));
    }
    const requestId = randomUUID();
    const frame = encodeFrame({
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      command,
    });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`Reference Core request timed out: ${command.method}`));
      }, timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timeout });
      child.stdin.write(frame, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.#pending.delete(requestId);
        reject(error);
      });
    });
  }

  #receive(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0);
      if (length > MAX_FRAME_BYTES) {
        this.#handleExit(new Error("Reference Core emitted an oversized frame"));
        this.#child?.kill("SIGKILL");
        return;
      }
      if (this.#buffer.length < 4 + length) return;
      const payload = this.#buffer.subarray(4, 4 + length);
      this.#buffer = this.#buffer.subarray(4 + length);
      let frame;
      try {
        frame = JSON.parse(payload.toString("utf8"));
      } catch {
        this.#handleExit(new Error("Reference Core emitted invalid JSON"));
        this.#child?.kill("SIGKILL");
        return;
      }
      if (frame.kind === "event") {
        this.emit("event", frame.event);
        continue;
      }
      const pending = this.#pending.get(frame.requestId);
      if (!pending) continue;
      clearTimeout(pending.timeout);
      this.#pending.delete(frame.requestId);
      if (frame.kind === "error") {
        const error = new Error(frame.error?.message ?? "Reference Core request failed");
        error.code = frame.error?.code;
        error.retryable = Boolean(frame.error?.retryable);
        pending.reject(error);
      } else {
        pending.resolve(frame.result);
      }
    }
  }

  #handleExit(error) {
    if (!this.#child && this.#pending.size === 0) return;
    this.#child = null;
    this.#buffer = Buffer.alloc(0);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
    if (!this.#stopping) {
      this.emit("event", {
        event: "core_needs_restart",
        value: { reason: "Reference Core stopped. Writes are frozen until restart." },
      });
    }
  }
}

export function encodeFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length > MAX_FRAME_BYTES) throw new Error("Control frame exceeds 1 MiB");
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function resolveCorePath() {
  if (process.env.REFERENCE_CORE_PATH) return path.resolve(process.env.REFERENCE_CORE_PATH);
  return path.join(process.resourcesPath, "bin", "reference-core");
}

function sanitizedEnvironment(enableTestCommands = false) {
  const allowed = ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "XDG_RUNTIME_DIR"];
  const environment = Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
  );
  if (enableTestCommands) environment.PITCHDOG_ENABLE_TEST_COMMANDS = "1";
  return environment;
}
