import { constants } from "node:fs";
import { open } from "node:fs/promises";

const MAXIMUM_RESOURCE_BYTES = 512 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function authorizedResourceResponse(
  descriptor,
  { signal, onHandleValidated, onHandleClosed } = {},
) {
  const nativePath = descriptor?.nativePathForHandler;
  const contentLength = descriptor?.contentLength;
  const mimeType = descriptor?.mimeType;
  if (typeof nativePath !== "string" || !MIME_TYPES.has(mimeType) ||
      !Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAXIMUM_RESOURCE_BYTES) {
    throw safeFailure("ResourceDescriptorInvalid");
  }
  if (signal?.aborted) throw abortError();

  let handle;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    handle = await open(nativePath, constants.O_RDONLY | noFollow);
  } catch {
    throw safeFailure("ResourceOpenDenied");
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { await handle.close(); } finally { onHandleClosed?.(); }
  };

  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== contentLength) throw safeFailure("ResourceChanged");
    await onHandleValidated?.({ size: metadata.size });
    if (signal?.aborted) throw abortError();
  } catch (error) {
    await close();
    throw error?.name === "AbortError" || error?.resourceSafe ? error : safeFailure("ResourceChanged");
  }

  let position = 0;
  let controller;
  const abort = () => {
    void close().finally(() => controller?.error(abortError()));
  };
  signal?.addEventListener("abort", abort, { once: true });
  const finish = async () => {
    signal?.removeEventListener("abort", abort);
    await close();
  };

  const body = new ReadableStream({
    start(value) { controller = value; },
    async pull(value) {
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

function safeFailure(code) {
  const error = new Error("Authorized resource could not be delivered");
  error.code = code;
  error.resourceSafe = true;
  return error;
}
function abortError() { return new DOMException("Resource request aborted", "AbortError"); }

export const resourceStreamLimits = Object.freeze({
  maximumResourceBytes: MAXIMUM_RESOURCE_BYTES,
  streamChunkBytes: STREAM_CHUNK_BYTES,
});
