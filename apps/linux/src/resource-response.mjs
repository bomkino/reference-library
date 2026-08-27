import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MAXIMUM_RESOURCE_BYTES = 512 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;
const MAXIMUM_OPEN_RESOURCE_HANDLES = 32;
const RESOURCE_IDLE_TIMEOUT_MS = 30_000;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
let activeResourceHandles = 0;

export async function authorizedResourceResponse(
  descriptor,
  {
    signal, onHandleValidated, onHandleClosed,
    cacheRoot = privateResourceCacheRoot(), idleTimeoutMs = RESOURCE_IDLE_TIMEOUT_MS,
  } = {},
) {
  const nativePath = descriptor?.nativePathForHandler;
  const contentLength = descriptor?.contentLength;
  const mimeType = descriptor?.mimeType;
  if (typeof nativePath !== "string" || !MIME_TYPES.has(mimeType) ||
      !Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAXIMUM_RESOURCE_BYTES) {
    throw safeFailure("ResourceDescriptorInvalid");
  }
  if (signal?.aborted) throw abortError();
  if (activeResourceHandles >= MAXIMUM_OPEN_RESOURCE_HANDLES) {
    throw safeFailure("ResourceHandleCapacityExceeded");
  }

  let handle;
  activeResourceHandles += 1;
  try {
    await assertPrivateCachePath(nativePath, cacheRoot);
    const noFollow = constants.O_NOFOLLOW ?? 0;
    handle = await open(nativePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    activeResourceHandles -= 1;
    throw error?.resourceSafe ? error : safeFailure("ResourceOpenDenied");
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { await handle.close(); } finally {
      activeResourceHandles -= 1;
      onHandleClosed?.();
    }
  };

  try {
    const metadata = await handle.stat();
    const owner = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
    if (!metadata.isFile() || metadata.size !== contentLength || metadata.uid !== owner ||
        (metadata.mode & 0o022) !== 0 || metadata.nlink !== 1) throw safeFailure("ResourceChanged");
    await onHandleValidated?.({ size: metadata.size, device: metadata.dev, inode: metadata.ino });
    if (signal?.aborted) throw abortError();
  } catch (error) {
    await close();
    throw error?.name === "AbortError" || error?.resourceSafe ? error : safeFailure("ResourceChanged");
  }

  let position = 0;
  let controller;
  let idleTimer;
  const armIdleTimeout = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void close().finally(() => controller?.error(safeFailure("ResourceStreamTimedOut")));
    }, idleTimeoutMs);
    idleTimer.unref?.();
  };
  const abort = () => {
    clearTimeout(idleTimer);
    void close().finally(() => controller?.error(abortError()));
  };
  signal?.addEventListener("abort", abort, { once: true });
  const finish = async () => {
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", abort);
    await close();
  };

  const body = new ReadableStream({
    start(value) { controller = value; armIdleTimeout(); },
    async pull(value) {
      armIdleTimeout();
      if (closed) return;
      if (signal?.aborted) { await finish(); value.error(abortError()); return; }
      if (position === contentLength) { await finish(); value.close(); return; }
      const length = Math.min(STREAM_CHUNK_BYTES, contentLength - position);
      const buffer = Buffer.allocUnsafe(length);
      try {
        const { bytesRead } = await handle.read(buffer, 0, length, position);
        if (bytesRead !== length) throw safeFailure("ResourceChanged");
        position += bytesRead;
        value.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
      } catch (error) {
        await finish();
        value.error(error?.name === "AbortError" || error?.resourceSafe ? error : safeFailure("ResourceReadFailed"));
      }
    },
    async cancel() { await finish(); },
  });

  return new Response(body, {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(contentLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function assertPrivateCachePath(nativePath, cacheRoot) {
  try {
    const rootMetadata = await lstat(cacheRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw safeFailure("ResourceCacheUnsafe");
    const [resolvedRoot, resolvedCandidate] = await Promise.all([realpath(cacheRoot), realpath(nativePath)]);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      throw safeFailure("ResourceCacheUnsafe");
    }
  } catch (error) {
    throw error?.resourceSafe ? error : safeFailure("ResourceCacheUnsafe");
  }
}

export function privateResourceCacheRoot() {
  return path.join(tmpdir(), "pitchdog-reference-cache", "reference-library-v1");
}

export function activeResourceHandleCount() { return activeResourceHandles; }

function safeFailure(code) {
  const error = new Error("Authorized resource could not be delivered");
  error.code = code;
  error.resourceSafe = true;
  return error;
}
function abortError() { return new DOMException("Resource request aborted", "AbortError"); }

export const resourceStreamLimits = Object.freeze({
  maximumResourceBytes: MAXIMUM_RESOURCE_BYTES,
  maximumOpenResourceHandles: MAXIMUM_OPEN_RESOURCE_HANDLES,
  resourceIdleTimeoutMs: RESOURCE_IDLE_TIMEOUT_MS,
  streamChunkBytes: STREAM_CHUNK_BYTES,
});
