import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { CoreSupervisor, encodeFrame, supervisorLimits } from "../src/core-supervisor.mjs";

const SESSION = "b4c27ebf-1dd5-4a03-9b8b-4eebd43947a0";
const ASSET = "45c16e93-f8e4-4fb9-970f-783ae9d34c18";
const LOCATION = "89a9cb5f-568c-4a58-b850-92d39288918f";
const TOKEN = "a118c00c-601d-4f48-811c-cef54939d35d";

test("unknown response IDs fail closed and emit one path-free restart event", async () => {
  const harness = fakeCore(({ envelope, send }) => {
    if (envelope.command.method === "bad_reply") {
      send(response("not-the-request", { result: "shutdown" }));
      return true;
    }
    return false;
  });
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  const events = [];
  core.on("event", (event) => events.push(event));
  await core.start();
  await assert.rejects(core.request({ method: "bad_reply" }), /unknown request/);
  assert.equal(core.running, false);
  assert.deepEqual(events, [{
    event: "core_needs_restart",
    value: { reason: "Reference Core stopped. Writes are frozen until restart." },
  }]);
});

test("a request timeout reaps the helper and rejects every in-flight request", async () => {
  const harness = fakeCore(({ envelope }) => envelope.command.method === "hang");
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  const first = core.request({ method: "hang" }, 15);
  const second = core.request({ method: "hang" }, 1_000);
  await assert.rejects(first, /timed out/);
  await assert.rejects(second, /timed out/);
  assert.deepEqual(harness.kills, ["SIGKILL"]);
});

test("resource authorization requires exact async correlation", async () => {
  const params = resourceParams();
  const harness = fakeCore(({ envelope, send }) => {
    if (envelope.command.method !== "authorize_resource") return false;
    send(resourceStarted(
      envelope.requestId,
      { assetId: params.assetId, profile: params.profile },
      "16d39431-f407-4e44-986b-b54005380275",
    ));
    send(response(envelope.requestId, { result: "resource_authorized", value: descriptor(params) }));
    return true;
  });
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  const result = await core.authorizeResource(params);
  assert.equal(result.result, "resource_authorized");
});

test("resource correlation rejects invented fields that are absent from the Core event", async () => {
  const params = resourceParams();
  const harness = fakeCore(({ envelope, send }) => {
    if (envelope.command.method !== "authorize_resource") return false;
    const event = resourceStarted(envelope.requestId, params, "16d39431-f407-4e44-986b-b54005380275");
    event.event.value.sessionId = params.sessionId;
    send(event);
    return true;
  });
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  await assert.rejects(core.authorizeResource(params), /invalid event/);
  assert.equal(core.running, false);
});

test("mismatched resource correlation freezes the generation", async () => {
  const params = resourceParams();
  const harness = fakeCore(({ envelope, send }) => {
    if (envelope.command.method !== "authorize_resource") return false;
      send(resourceStarted(envelope.requestId, { ...params, assetId: LOCATION }, "16d39431-f407-4e44-986b-b54005380275"));
    return true;
  });
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  await assert.rejects(core.authorizeResource(params), /mismatched resource correlation/);
  assert.equal(core.running, false);
});

test("resource abort cancels the exactly correlated Core job", async () => {
  const params = resourceParams();
  const cancelled = [];
  const harness = fakeCore(({ envelope, send }) => {
    if (envelope.command.method === "authorize_resource") {
      send(resourceStarted(envelope.requestId, params, "16d39431-f407-4e44-986b-b54005380275"));
      setTimeout(() => send(response(envelope.requestId, {
        result: "resource_authorized", value: descriptor(params),
      })), 40);
      return true;
    }
    if (envelope.command.method === "cancel_job") {
      cancelled.push(envelope.command.params.jobId);
      send(response(envelope.requestId, { result: "job_cancellation", value: {
        jobId: envelope.command.params.jobId, state: "cancellation_requested",
      } }));
      return true;
    }
    return false;
  });
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  const controller = new AbortController();
  const authorization = core.authorizeResource(params, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(authorization, { name: "AbortError" });
  await waitFor(() => cancelled.length === 1);
  assert.deepEqual(cancelled, ["16d39431-f407-4e44-986b-b54005380275"]);
  await core.stop();
});

test("an abort before correlation cancels when the exact job event arrives", async () => {
  const params = resourceParams();
  const cancelled = [];
  const harness = fakeCore(({ envelope, send }) => {
    if (envelope.command.method === "authorize_resource") {
      setTimeout(() => send(resourceStarted(envelope.requestId, params, "16d39431-f407-4e44-986b-b54005380275")), 15);
      setTimeout(() => send(response(envelope.requestId, {
        result: "resource_authorized", value: descriptor(params),
      })), 30);
      return true;
    }
    if (envelope.command.method === "cancel_job") {
      cancelled.push(envelope.command.params.jobId);
      send(response(envelope.requestId, { result: "job_cancellation", value: {
        jobId: envelope.command.params.jobId, state: "cancellation_requested",
      } }));
      return true;
    }
    return false;
  });
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  const controller = new AbortController();
  const authorization = core.authorizeResource(params, { signal: controller.signal });
  controller.abort();
  await assert.rejects(authorization, { name: "AbortError" });
  await waitFor(() => cancelled.length === 1);
  assert.deepEqual(cancelled, ["16d39431-f407-4e44-986b-b54005380275"]);
  await new Promise((resolve) => setTimeout(resolve, 35));
  await core.stop();
});

test("retryable queue pressure has a strict bounded retry", async () => {
  const params = resourceParams();
  let attempts = 0;
  const harness = fakeCore(({ envelope, send }) => {
    if (envelope.command.method !== "authorize_resource") return false;
    attempts += 1;
    if (attempts < 3) {
      send(error(envelope.requestId, "RenditionQueueFull", true));
    } else {
      send(resourceStarted(envelope.requestId, params, "16d39431-f407-4e44-986b-b54005380275"));
      send(response(envelope.requestId, { result: "resource_authorized", value: descriptor(params) }));
    }
    return true;
  });
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  assert.equal((await core.authorizeResource(params)).result, "resource_authorized");
  assert.equal(attempts, 3);
  await core.stop();
});

test("malformed command results and unknown events fail the generation closed", async () => {
  for (const frameFor of [
    (requestId) => response(requestId, { result: "capabilities", value: { detail: [] } }),
    () => ({ protocolVersion: 1, kind: "event", sequence: 1, event: { event: "mystery", value: {} } }),
  ]) {
    const harness = fakeCore(({ envelope, send }) => {
      if (envelope.command.method !== "malformed") return false;
      send(frameFor(envelope.requestId));
      return true;
    });
    const core = new CoreSupervisor({ spawnProcess: harness.spawn });
    await core.start();
    await assert.rejects(core.request({ method: "malformed" }), /invalid/);
    assert.equal(core.running, false);
  }
});

test("stale child data, diagnostics, errors, and exit cannot affect a replacement generation", async () => {
  const harness = fakeCore(({ envelope, send }) => {
    if (envelope.command.method !== "fail_generation") return false;
    send(response("00000000-0000-4000-8000-000000000099", { result: "shutdown" }));
    return true;
  });
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  const diagnostics = [];
  core.on("diagnostic", (message) => diagnostics.push(message));
  await core.start();
  const stale = harness.children[0];
  await assert.rejects(core.request({ method: "fail_generation" }), /unknown request/);
  await core.start();
  stale.stdout.write(encodeFrame({
    protocolVersion: 1, kind: "event", sequence: 1,
    event: { event: "core_needs_restart", value: { reason: "/private/stale" } },
  }));
  stale.stderr.write("/private/stale diagnostic");
  stale.emit("error", new Error("stale"));
  stale.emit("exit", 1, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(core.running, true);
  assert.deepEqual(diagnostics, []);
  await core.stop();
});

test("pending Core requests are bounded and capacity is released on generation failure", async () => {
  const harness = fakeCore(({ envelope }) => envelope.command.method === "hang");
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  const requests = Array.from({ length: supervisorLimits.maximumPendingRequests }, () =>
    core.request({ method: "hang" }, 40).catch((error) => error));
  await assert.rejects(
    core.request({ method: "hang" }),
    (error) => error.code === "CoreRequestCapacityExceeded" && !error.message.includes("/"),
  );
  const failures = await Promise.all(requests);
  assert.ok(failures.every((error) => /timed out/.test(error.message)));
  assert.equal(core.running, false);
});

test("Core writes are serialized through callback backpressure", async () => {
  const harness = backpressuredCore();
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  await Promise.all([
    core.request({ method: "get_capabilities", params: { sessionId: null } }),
    core.request({ method: "get_capabilities", params: { sessionId: null } }),
    core.request({ method: "get_capabilities", params: { sessionId: null } }),
  ]);
  assert.equal(harness.maximumConcurrentWrites(), 1);
  await core.stop();
});

test("pending resource authorizations are bounded and abort releases every caller", async () => {
  const harness = fakeCore(({ envelope }) => envelope.command.method === "authorize_resource");
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  const controllers = Array.from(
    { length: supervisorLimits.maximumResourceAuthorizations },
    () => new AbortController(),
  );
  const pending = controllers.map((controller) =>
    core.authorizeResource(resourceParams(), { signal: controller.signal }).catch((error) => error));
  await assert.rejects(
    core.authorizeResource(resourceParams()),
    (error) => error.code === "ResourceAuthorizationCapacityExceeded",
  );
  controllers.forEach((controller) => controller.abort());
  assert.ok((await Promise.all(pending)).every((error) => error.name === "AbortError"));
  await core.stop();
});

function fakeCore(customHandler) {
  const kills = [];
  const children = [];
  return {
    kills,
    children,
    spawn: () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.exitCode = null;
      child.signalCode = null;
      child.kill = (signal) => {
        if (child.exitCode !== null || child.signalCode !== null) return false;
        kills.push(signal);
        child.signalCode = signal;
        queueMicrotask(() => child.emit("exit", null, signal));
        return true;
      };
      children.push(child);
      let buffer = Buffer.alloc(0);
      child.stdin.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
          const length = buffer.readUInt32BE(0);
          const envelope = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"));
          buffer = buffer.subarray(4 + length);
          const send = (frame) => queueMicrotask(() => child.stdout.write(encodeFrame(frame)));
          if (customHandler?.({ envelope, send, child })) continue;
          if (envelope.command.method === "hello") {
            send(response(envelope.requestId, {
              result: "hello", value: {
                protocolVersion: 1, coreVersion: "test", maxPageSize: 250, features: [],
              },
            }));
          } else if (envelope.command.method === "shutdown") {
            send(response(envelope.requestId, { result: "shutdown" }));
            setTimeout(() => {
              child.exitCode = 0;
              child.emit("exit", 0, null);
            }, 1);
          }
        }
      });
      return child;
    },
  };
}

function backpressuredCore() {
  let activeWrites = 0;
  let maximumWrites = 0;
  return {
    maximumConcurrentWrites: () => maximumWrites,
    spawn: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.exitCode = null;
      child.signalCode = null;
      child.stdin = {
        writable: true,
        write(frame, callback) {
          activeWrites += 1;
          maximumWrites = Math.max(maximumWrites, activeWrites);
          setTimeout(() => {
            const length = frame.readUInt32BE(0);
            const envelope = JSON.parse(frame.subarray(4, 4 + length).toString("utf8"));
            const method = envelope.command.method;
            const result = method === "hello"
              ? { result: "hello", value: { protocolVersion: 1, coreVersion: "test", maxPageSize: 250, features: [] } }
              : method === "get_capabilities"
                ? { result: "capabilities", value: capabilities() }
                : { result: "shutdown" };
            child.stdout.write(encodeFrame(response(envelope.requestId, result)));
            activeWrites -= 1;
            callback();
            if (method === "shutdown") {
              child.exitCode = 0;
              child.emit("exit", 0, null);
            }
          }, 5);
          return false;
        },
      };
      child.kill = (signal) => {
        child.signalCode = signal;
        queueMicrotask(() => child.emit("exit", null, signal));
      };
      return child;
    },
  };
}

function capabilities() {
  return {
    chooseRoot: true, revealLocation: true, opaqueAssetResources: true,
    sourceMutation: false, detail: [],
  };
}

function response(requestId, result) {
  return { protocolVersion: 1, kind: "response", requestId, result };
}
function error(requestId, code, retryable) {
  return { protocolVersion: 1, kind: "error", requestId, error: { code, message: "private", retryable } };
}
function resourceStarted(requestId, params, jobId) {
  return {
    protocolVersion: 1,
    kind: "event",
    sequence: 1,
    event: { event: "resource_authorization_started", value: {
      requestId, jobId, assetId: params.assetId, profile: params.profile,
    } },
  };
}
function resourceParams() {
  return { sessionId: SESSION, assetId: ASSET, profile: "preview" };
}
function descriptor(params) {
  return {
    ...params, resourceToken: TOKEN, locationId: LOCATION,
    nativePathForHandler: "/private/path", mimeType: "image/png", contentLength: 1,
  };
}
async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("timed out waiting for test seam");
}
