import assert from "node:assert/strict";
import { mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  activeResourceHandleCount,
  authorizedResourceResponse,
  resourceStreamLimits,
} from "../src/resource-response.mjs";

test("opaque resources stream the verified handle in bounded chunks", async () => {
  await withTemporary("bounded", async (directory) => {
    const file = path.join(directory, "large-still.png");
    const bytes = Buffer.alloc(resourceStreamLimits.streamChunkBytes * 3 + 17, 7);
    await writeFile(file, bytes);
    let closes = 0;
    const response = await authorizedResourceResponse(descriptor(file, bytes.length), {
      cacheRoot: directory,
      onHandleClosed: () => { closes += 1; },
    });
    const chunks = await readChunks(response);
    assert.equal(Buffer.concat(chunks).compare(bytes), 0);
    assert.ok(chunks.every((chunk) => chunk.length <= resourceStreamLimits.streamChunkBytes));
    assert.equal(closes, 1);
  });
});

test("descriptor length changes fail closed without a native path in the error", async () => {
  await withTemporary("changed", async (directory) => {
    const file = path.join(directory, "still.png");
    await writeFile(file, Buffer.alloc(32));
    await assert.rejects(
      authorizedResourceResponse(descriptor(file, 31), { cacheRoot: directory }),
      (error) => error.code === "ResourceChanged" && !error.message.includes(directory),
    );
  });
});

test("pre-open symbolic links are rejected", async () => {
  await withTemporary("symlink", async (directory) => {
    const target = path.join(directory, "target.png");
    const link = path.join(directory, "link.png");
    await writeFile(target, Buffer.alloc(8, 1));
    await symlink(target, link);
    await assert.rejects(
      authorizedResourceResponse(descriptor(link, 8), { cacheRoot: directory }),
      { code: "ResourceOpenDenied" },
    );
  });
});

test("a same-size path replacement after fstat never changes delivered bytes", async () => {
  await withTemporary("swap", async (directory) => {
    const candidate = path.join(directory, "candidate.png");
    const replacement = path.join(directory, "replacement.png");
    const retained = path.join(directory, "retained.png");
    await writeFile(candidate, Buffer.from("original"));
    await writeFile(replacement, Buffer.from("replaced"));
    const response = await authorizedResourceResponse(descriptor(candidate, 8), {
      cacheRoot: directory,
      onHandleValidated: async () => {
        await rename(candidate, retained);
        await rename(replacement, candidate);
      },
    });
    assert.equal(Buffer.concat(await readChunks(response)).toString(), "original");
  });
});

test("a symlink path swap after validation never redirects the verified handle", async () => {
  await withTemporary("symlink-swap", async (directory) => {
    const candidate = path.join(directory, "candidate.png");
    const other = path.join(directory, "other.png");
    const retained = path.join(directory, "retained.png");
    await writeFile(candidate, Buffer.from("trusted!"));
    await writeFile(other, Buffer.from("hostile!"));
    const response = await authorizedResourceResponse(descriptor(candidate, 8), {
      cacheRoot: directory,
      onHandleValidated: async () => {
        await rename(candidate, retained);
        await symlink(other, candidate);
      },
    });
    assert.equal(Buffer.concat(await readChunks(response)).toString(), "trusted!");
  });
});

test("abort before reading closes the verified descriptor", async () => {
  await withTemporary("pre-abort", async (directory) => {
    const file = path.join(directory, "still.png");
    await writeFile(file, Buffer.alloc(32));
    const controller = new AbortController();
    let closes = 0;
    await assert.rejects(
      authorizedResourceResponse(descriptor(file, 32), {
        cacheRoot: directory,
        signal: controller.signal,
        onHandleValidated: () => controller.abort(),
        onHandleClosed: () => { closes += 1; },
      }),
      { name: "AbortError" },
    );
    assert.equal(closes, 1);
  });
});

test("mid-stream abort closes the descriptor and does not finish", async () => {
  await withTemporary("mid-abort", async (directory) => {
    const file = path.join(directory, "large.png");
    const bytes = Buffer.alloc(resourceStreamLimits.streamChunkBytes * 4, 3);
    await writeFile(file, bytes);
    const controller = new AbortController();
    let closes = 0;
    const response = await authorizedResourceResponse(descriptor(file, bytes.length), {
      cacheRoot: directory,
      signal: controller.signal,
      onHandleClosed: () => { closes += 1; },
    });
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    controller.abort();
    await assert.rejects(reader.read(), { name: "AbortError" });
    await waitFor(() => closes === 1);
  });
});

test("resource paths outside the private Core cache fail before open", async () => {
  await withTemporary("confinement", async (directory) => {
    const cache = path.join(directory, "cache");
    const outside = path.join(directory, "outside.png");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(cache));
    await writeFile(outside, Buffer.alloc(8));
    await assert.rejects(
      authorizedResourceResponse(descriptor(outside, 8), { cacheRoot: cache }),
      (error) => error.code === "ResourceCacheUnsafe" && !error.message.includes(directory),
    );
  });
});

test("concurrent verified handles are bounded and every reservation is released", async () => {
  await withTemporary("handle-cap", async (directory) => {
    const file = path.join(directory, "still.png");
    await writeFile(file, Buffer.alloc(8));
    const responses = await Promise.all(Array.from(
      { length: resourceStreamLimits.maximumOpenResourceHandles },
      () => authorizedResourceResponse(descriptor(file, 8), { cacheRoot: directory }),
    ));
    assert.equal(activeResourceHandleCount(), resourceStreamLimits.maximumOpenResourceHandles);
    await assert.rejects(
      authorizedResourceResponse(descriptor(file, 8), { cacheRoot: directory }),
      { code: "ResourceHandleCapacityExceeded" },
    );
    await Promise.all(responses.map((response) => response.body.cancel()));
    assert.equal(activeResourceHandleCount(), 0);
  });
});

function descriptor(nativePathForHandler, contentLength) {
  return { nativePathForHandler, mimeType: "image/png", contentLength };
}
async function readChunks(response) {
  const reader = response.body.getReader();
  const chunks = [];
  for (;;) {
    const part = await reader.read();
    if (part.done) return chunks;
    chunks.push(Buffer.from(part.value));
  }
}
async function withTemporary(label, operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `reference-resource-${label}-`));
  try { await operation(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("timed out waiting for descriptor close");
}
