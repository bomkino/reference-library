import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFrame } from "../src/core-supervisor.mjs";

test("control frames are big-endian length-prefixed and bounded", () => {
  const value = { protocolVersion: 1, requestId: "request", command: { method: "shutdown" } };
  const frame = encodeFrame(value);
  assert.equal(frame.readUInt32BE(0), frame.length - 4);
  assert.deepEqual(JSON.parse(frame.subarray(4).toString("utf8")), value);
  assert.throws(() => encodeFrame({ value: "x".repeat(1024 * 1024) }), /exceeds 1 MiB/);
});
