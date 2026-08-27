import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

const MAXIMUM_RESOURCE_BYTES = 512 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;

export async function authorizedResourceResponse(descriptor, { signal } = {}) {
  const nativePath = descriptor?.nativePathForHandler;
  const contentLength = descriptor?.contentLength;
  if (
    typeof nativePath !== "string" ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > MAXIMUM_RESOURCE_BYTES
  ) {
    throw new Error("Invalid resource descriptor");
  }
  if (signal?.aborted) throw new DOMException("Resource request aborted", "AbortError");

  const metadata = await stat(nativePath);
  if (!metadata.isFile() || metadata.size !== contentLength) {
    throw new Error("Source changed before resource delivery");
  }

  const source = createReadStream(nativePath, { highWaterMark: STREAM_CHUNK_BYTES });
  const abort = () => source.destroy(new DOMException("Resource request aborted", "AbortError"));
  signal?.addEventListener("abort", abort, { once: true });
  source.once("close", () => signal?.removeEventListener("abort", abort));

  return new Response(Readable.toWeb(source), {
    headers: {
      "Content-Type": descriptor.mimeType,
      "Content-Length": String(contentLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const resourceStreamLimits = Object.freeze({
  maximumResourceBytes: MAXIMUM_RESOURCE_BYTES,
  streamChunkBytes: STREAM_CHUNK_BYTES,
});
