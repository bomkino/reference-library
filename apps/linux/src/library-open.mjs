import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function libraryPathFromArgument(argument) {
  if (typeof argument !== "string" || !argument || argument.startsWith("--")) return null;
  let candidate = argument;
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    let url;
    try { url = new URL(candidate); } catch { return null; }
    if (url.protocol !== "file:") return null;
    candidate = fileURLToPath(url);
  }
  const absolute = path.resolve(candidate);
  return path.extname(absolute) === ".pitchlibrary" ? absolute : null;
}

export function collectLibraryOpenArguments(argv) {
  if (!Array.isArray(argv)) throw new TypeError("argv must be an array");
  return [...new Set(argv.map(libraryPathFromArgument).filter(Boolean))];
}

export async function assertPitchLibraryPackage(candidate) {
  const libraryPath = libraryPathFromArgument(candidate);
  if (!libraryPath) throw new TypeError("Choose a .pitchlibrary package directory");
  const metadata = await lstat(libraryPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError("A .pitchlibrary must be a real package directory");
  }
  for (const required of ["manifest.json", "library.sqlite"]) {
    const child = await lstat(path.join(libraryPath, required));
    if (!child.isFile() || child.isSymbolicLink()) throw new TypeError(`Invalid .pitchlibrary package: ${required}`);
  }
  return await realpath(libraryPath);
}
