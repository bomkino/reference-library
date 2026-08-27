import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  activeResourceHandleCount,
  authorizedResourceResponse,
  resourceStreamLimits,
} from "../src/resource-response.mjs";
import {
  SessionResourceAuthority,
  sessionResourceLimits,
} from "../src/session-resource-authority.mjs";

const FIRST_SESSION = "b4c27ebf-1dd5-4a03-9b8b-4eebd43947a0";
const SECOND_SESSION = "b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1";

test("closing a session aborts and drains an already-authorized stream before replacement authority", async () => {
  await withTemporary("close-stream", async (directory) => {
    const file = path.join(directory, "large.png");
    const bytes = Buffer.alloc(resourceStreamLimits.streamChunkBytes * 4, 7);
    await writeFile(file, bytes);
    const authority = new SessionResourceAuthority();
    authority.adopt(FIRST_SESSION);
    const lease = authority.acquire(FIRST_SESSION);
    const response = await authorizedResourceResponse(descriptor(file, bytes.length), {
      cacheRoot: directory,
      signal: lease.signal,
      onHandleClosed: lease.release,
    });
    const reader = response.body.getReader();
    assert.equal((await reader.read()).done, false);
    assert.equal(activeResourceHandleCount(), 1);

    const drained = authority.revoke(FIRST_SESSION);
    await assert.rejects(reader.read(), { name: "AbortError" });
    await drained;
    assert.equal(authority.activeLeaseCount, 0);
    assert.equal(activeResourceHandleCount(), 0);
    assert.throws(() => authority.acquire(FIRST_SESSION), { code: "SessionClosed" });

    authority.adopt(SECOND_SESSION);
    const replacement = authority.acquire(SECOND_SESSION);
    const next = await authorizedResourceResponse(descriptor(file, bytes.length), {
      cacheRoot: directory,
      signal: replacement.signal,
      onHandleClosed: replacement.release,
    });
    await next.body.cancel();
    assert.equal(authority.activeLeaseCount, 0);
    assert.equal(activeResourceHandleCount(), 0);
  });
});

test("request abort remains scoped and revocation releases bounded registry capacity", async () => {
  const authority = new SessionResourceAuthority();
  authority.adopt(FIRST_SESSION);
  const request = new AbortController();
  const requestLease = authority.acquire(FIRST_SESSION, request.signal);
  request.abort();
  assert.equal(requestLease.signal.aborted, true);
  requestLease.release();

  const leases = Array.from(
    { length: sessionResourceLimits.maximumSessionResourceLeases },
    () => authority.acquire(FIRST_SESSION),
  );
  assert.throws(() => authority.acquire(FIRST_SESSION), { code: "ResourceStreamCapacityExceeded" });
  for (const lease of leases) lease.signal.addEventListener("abort", lease.release, { once: true });
  await authority.revoke(FIRST_SESSION);
  assert.equal(authority.activeLeaseCount, 0);

  authority.adopt(SECOND_SESSION);
  const afterDrain = authority.acquire(SECOND_SESSION);
  afterDrain.release();
  assert.equal(authority.activeLeaseCount, 0);
});

function descriptor(nativePathForHandler, contentLength) {
  return { nativePathForHandler, mimeType: "image/png", contentLength };
}

async function withTemporary(label, operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `reference-authority-${label}-`));
  try { await operation(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
