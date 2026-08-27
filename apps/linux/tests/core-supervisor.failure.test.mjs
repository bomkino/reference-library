import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { CoreSupervisor, encodeFrame } from "../src/core-supervisor.mjs";

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
    send(resourceStarted(envelope.requestId, params, "job-1"));
    send(response(envelope.requestId, { result: "resource_authorized", value: descriptor(params) }));
    return true;
  });
  const core = new CoreSupervisor({ spawnProcess: harness.spawn });
  await core.start();
  const result = await core.authorizeResource(params);
  assert.equal(result.result, "resource_authorized");
});

test("mismatched resource correlation freezes the generation", async () => {
  const params = resourceParams();
  const harness = fakeCore(({ envelope, send }) => {
    if (envelope.command.method !== "authorize_resource") return false;
    send(resourceStarted(envelope.requestId, { ...params, assetId: "wrong" }, "job-1"));
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
      send(resourceStarted(envelope.requestId, params, "job-abort"));
      setTimeout(() => send(response(envelope.requestId, {
        result: "resource_authorized", value: descriptor(params),
      })), 40);
      return true;
    }
    if (envelope.command.method === "cancel_job") {
      cancelled.push(envelope.command.params.jobId);
      send(response(envelope.requestId, { result: "job_cancellation", value: {} }));
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
  assert.deepEqual(cancelled, ["job-abort"]);
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
      send(resourceStarted(envelope.requestId, params, "job-final"));
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

function fakeCore(customHandler) {
  const kills = [];
  return {
    kills,
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
              result: "hello", value: { protocolVersion: 1, coreVersion: "test" },
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
    event: { event: "resource_authorization_started", value: { requestId, jobId, ...params } },
  };
}
function resourceParams() {
  return { sessionId: "session-1", assetId: "asset-1", profile: "preview" };
}
function descriptor(params) {
  return { ...params, nativePathForHandler: "/private/path", mimeType: "image/png", contentLength: 1 };
}
async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("timed out waiting for test seam");
}
