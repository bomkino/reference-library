import path from "node:path";

export function resolveBundledUiPath(bundleRoot, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    throw new Error("Malformed UI resource path");
  }
  const relative = decoded.replace(/^\/+/, "") || "index.html";
  if (relative.split("/").includes("..") || path.isAbsolute(relative)) {
    throw new Error("UI resource traversal denied");
  }
  const root = path.resolve(bundleRoot);
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("UI resource traversal denied");
  }
  return candidate;
}

export function isTrustedWorkspaceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "pitchdog-ui:" && url.host === "app";
  } catch {
    return false;
  }
}

export function mimeForUiPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".webp": "image/webp",
      ".woff2": "font/woff2",
    }[extension] ?? "application/octet-stream"
  );
}
