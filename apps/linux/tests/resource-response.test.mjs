import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  authorizedResourceResponse,
  resourceStreamLimits,
} from "../src/resource-response.mjs";

test("opaque resources stream in bounded chunks with an exact length", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-resource-stream-"));
  const file = path.join(temporary, "large-still.png");
  const bytes = Buffer.alloc(resourceStreamLimits.streamChunkBytes * 3 + 17, 7);
  try {
    await writeFile(file, bytes);
    const response = await authorizedResourceResponse({
      nativePathForHandler: file,
      mimeType: "image/png",
      contentLength: bytes.length,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), String(bytes.length));
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.ok(first.value.byteLength > 0);
    assert.ok(first.value.byteLength <= resourceStreamLimits.streamChunkBytes);
    await reader.cancel();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("opaque resources reject a changed source before opening the stream", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-resource-changed-"));
  const file = path.join(temporary, "still.png");
  try {
    await writeFile(file, Buffer.alloc(32));
    await assert.rejects(
      authorizedResourceResponse({
        nativePathForHandler: file,
        mimeType: "image/png",
        contentLength: 31,
      }),
      /Source changed/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
