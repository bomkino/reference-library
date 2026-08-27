import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 2_000;
const RESOURCE_RETRY_DELAYS_MS = Object.freeze([25, 75]);

export class CoreSupervisor extends EventEmitter {
  #child = null;
  #buffer = Buffer.alloc(0);
  #pending = new Map();
  #resourceAuthorizations = new Map();
  #stopping = false;
  #failedGeneration = false;
  #lastEventSequence = 0;
  #corePath;
  #clientName;
  #enableTestCommands;
  #spawn;

  constructor({ corePath, clientName = "garuda-electron", enableTestCommands = false, spawnProcess = spawn } = {}) {
    super();
    this.#corePath = corePath ?? (spawnProcess === spawn ? resolveCorePath() : "reference-core-test");
    this.#clientName = clientName;
    this.#enableTestCommands = enableTestCommands;
    this.#spawn = spawnProcess;
  }

  get running() { return this.#child !== null; }

  async start() {
    if (this.#child) return;
    this.#stopping = false;
    this.#failedGeneration = false;
    this.#buffer = Buffer.alloc(0);
    this.#lastEventSequence = 0;
    const child = this.#spawn(this.#corePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: sanitizedEnvironment(this.#enableTestCommands),
      windowsHide: true,
    });
    this.#child = child;
    child.stdout.on("data", (chunk) => this.#receive(chunk));
    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) this.emit("diagnostic", message.slice(0, 2_048));
    });
    child.once("error", () => this.#protocolFailure("Reference Core could not start"));
    child.once("exit", () => { if (!this.#stopping) this.#protocolFailure("Reference Core stopped"); });
    try {
      const hello = await this.request({
        method: "hello",
        params: { clientName: this.#clientName, supportedVersions: [PROTOCOL_VERSION] },
      });
      if (hello?.result !== "hello" || hello?.value?.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error("Reference Core protocol negotiation failed");
      }
    } catch (error) {
      this.#protocolFailure("Reference Core protocol negotiation failed");
      throw error;
    }
  }

  async restart() { await this.stop(); await this.start(); }

  async stop() {
    const child = this.#child;
    if (!child) return;
    this.#stopping = true;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try { await this.request({ method: "shutdown" }, STOP_GRACE_MS); } catch {}
    let stopped = child.exitCode !== null || child.signalCode !== null ||
      await Promise.race([exited.then(() => true), delay(STOP_GRACE_MS).then(() => false)]);
    if (!stopped && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      stopped = await Promise.race([exited.then(() => true), delay(STOP_GRACE_MS).then(() => false)]);
    }
    if (!stopped && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await Promise.race([exited, delay(STOP_GRACE_MS)]);
    }
    if (this.#child === child) this.#clearChild(new Error("Reference Core stopped"));
    this.#stopping = false;
  }

  request(command, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, options = {}) {
    const child = this.#child;
    if (!child?.stdin?.writable) return Promise.reject(new Error("Reference Core is not running"));
    const requestId = options.requestId ?? randomUUID();
    const frame = encodeFrame({ protocolVersion: PROTOCOL_VERSION, requestId, command });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.#pending.has(requestId)) this.#protocolFailure("Reference Core request timed out");
      }, timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timeout });
      child.stdin.write(frame, (error) => {
        if (error && this.#pending.has(requestId)) this.#protocolFailure("Reference Core transport failed");
      });
    });
  }

  async authorizeResource(params, { signal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
    assertResourceRequest(params);
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw abortError();
      const requestId = randomUUID();
      const authorization = { ...params, requestId, jobId: null, aborted: false };
      this.#resourceAuthorizations.set(requestId, authorization);
      const abort = () => {
        authorization.aborted = true;
        if (authorization.jobId) void this.#cancelResourceJob(params.sessionId, authorization.jobId);
      };
      signal?.addEventListener("abort", abort, { once: true });
      const request = this.request({ method: "authorize_resource", params }, timeoutMs, { requestId });
      let cleanupDeferred = false;
      try {
        const response = await withAbort(request, signal);
        if (authorization.aborted || signal?.aborted) throw abortError();
        if (!authorization.jobId) {
          this.#protocolFailure("Reference Core omitted resource job correlation");
          throw new Error("Reference Core omitted resource job correlation");
        }
        return response;
      } catch (error) {
        if (authorization.aborted || signal?.aborted || error?.name === "AbortError") {
          cleanupDeferred = true;
          void request.catch(() => {}).finally(() => this.#resourceAuthorizations.delete(requestId));
          throw abortError();
        }
        if (error?.code !== "RenditionQueueFull" || !error?.retryable || attempt >= RESOURCE_RETRY_DELAYS_MS.length) throw error;
        await abortableDelay(RESOURCE_RETRY_DELAYS_MS[attempt], signal);
      } finally {
        signal?.removeEventListener("abort", abort);
        if (!cleanupDeferred) this.#resourceAuthorizations.delete(requestId);
      }
    }
  }

  async #cancelResourceJob(sessionId, jobId) {
    try { await this.request({ method: "cancel_job", params: { sessionId, jobId } }, 2_000); } catch {}
  }

  #receive(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) { this.#protocolFailure("Reference Core emitted an invalid frame"); return; }
      if (this.#buffer.length < 4 + length) return;
      const payload = this.#buffer.subarray(4, 4 + length);
      this.#buffer = this.#buffer.subarray(4 + length);
      let frame;
      try { frame = JSON.parse(payload.toString("utf8")); }
      catch { this.#protocolFailure("Reference Core emitted invalid JSON"); return; }
      if (!isRecord(frame) || frame.protocolVersion !== PROTOCOL_VERSION || typeof frame.kind !== "string") {
        this.#protocolFailure("Reference Core emitted an invalid frame"); return;
      }
      if (frame.kind === "event") {
        if (!isRecord(frame.event) || typeof frame.event.event !== "string") {
          this.#protocolFailure("Reference Core emitted an invalid event"); return;
        }
        if (!Number.isSafeInteger(frame.sequence) || frame.sequence <= this.#lastEventSequence) {
          this.#protocolFailure("Reference Core emitted an invalid event sequence"); return;
        }
        this.#lastEventSequence = frame.sequence;
        if (frame.event.event === "resource_authorization_started") {
          if (!this.#receiveResourceAuthorization(frame.event.value)) return;
        } else this.emit("event", frame.event);
        continue;
      }
      if (frame.kind !== "response" && frame.kind !== "error") {
        this.#protocolFailure("Reference Core emitted an unknown frame kind"); return;
      }
      if (typeof frame.requestId !== "string" || !this.#pending.has(frame.requestId)) {
        this.#protocolFailure("Reference Core replied to an unknown request"); return;
      }
      const pending = this.#pending.get(frame.requestId);
      clearTimeout(pending.timeout);
      this.#pending.delete(frame.requestId);
      if (frame.kind === "error") {
        if (!isRecord(frame.error) || typeof frame.error.code !== "string") {
          this.#protocolFailure("Reference Core emitted an invalid error"); return;
        }
        const error = new Error("Reference Core request failed");
        error.code = frame.error.code;
        error.retryable = Boolean(frame.error.retryable);
        pending.reject(error);
      } else if (!isRecord(frame.result)) {
        this.#protocolFailure("Reference Core emitted an invalid response"); return;
      } else pending.resolve(frame.result);
    }
  }

  #receiveResourceAuthorization(value) {
    if (!isRecord(value) || typeof value.requestId !== "string" || typeof value.jobId !== "string") {
      this.#protocolFailure("Reference Core emitted an invalid resource correlation"); return false;
    }
    const authorization = this.#resourceAuthorizations.get(value.requestId);
    if (!authorization || authorization.jobId ||
        (value.sessionId !== undefined && value.sessionId !== authorization.sessionId) ||
        value.assetId !== authorization.assetId || value.profile !== authorization.profile) {
      this.#protocolFailure("Reference Core emitted a mismatched resource correlation"); return false;
    }
    authorization.jobId = value.jobId;
    if (authorization.aborted) void this.#cancelResourceJob(authorization.sessionId, value.jobId);
    return true;
  }

  #protocolFailure(reason) {
    if (this.#failedGeneration) return;
    this.#failedGeneration = true;
    const child = this.#child;
    this.#clearChild(new Error(reason));
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (!this.#stopping) this.emit("event", {
      event: "core_needs_restart",
      value: { reason: "Reference Core stopped. Writes are frozen until restart." },
    });
  }

  #clearChild(error) {
    this.#child = null;
    this.#buffer = Buffer.alloc(0);
    for (const pending of this.#pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.#pending.clear();
    this.#resourceAuthorizations.clear();
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
  return path.join(process.resourcesPath, "bin", "reference-core");
}
function sanitizedEnvironment(enableTestCommands = false) {
  const allowed = ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "XDG_RUNTIME_DIR"];
  const environment = Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
  if (enableTestCommands) environment.PITCHDOG_ENABLE_TEST_COMMANDS = "1";
  return environment;
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function abortError() { return new DOMException("Resource request aborted", "AbortError"); }
function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(abortError()); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}
function abortableDelay(ms, signal) { return withAbort(delay(ms), signal); }
function assertResourceRequest(params) {
  if (!isRecord(params) || !["grid_standard", "preview"].includes(params.profile) ||
      typeof params.sessionId !== "string" || typeof params.assetId !== "string") {
    throw new TypeError("Invalid resource authorization request");
  }
}
export const supervisorLimits = Object.freeze({
  maximumFrameBytes: MAX_FRAME_BYTES,
  resourceRetryDelaysMs: RESOURCE_RETRY_DELAYS_MS,
});
