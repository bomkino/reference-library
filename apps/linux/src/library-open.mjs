import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_LIBRARY_OPEN_ARGUMENTS = 16;

export function libraryPathFromArgument(argument) {
  if (typeof argument !== "string" || !argument || argument.startsWith("--")) return null;
  let candidate = argument;
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    let url;
    try { url = new URL(candidate); }
    catch { throw libraryOpenError("LibraryOpenArgumentInvalid", "The Library address is invalid"); }
    if (url.protocol !== "file:") return null;
    try { candidate = fileURLToPath(url); }
    catch { throw libraryOpenError("LibraryOpenArgumentInvalid", "The Library address is invalid"); }
  }
  const absolute = path.resolve(candidate);
  return path.extname(absolute) === ".pitchlibrary" ? absolute : null;
}

export function collectLibraryOpenArguments(argv) {
  if (!Array.isArray(argv)) throw new TypeError("argv must be an array");
  const candidates = [];
  const seen = new Set();
  for (const argument of argv) {
    if (typeof argument !== "string") throw libraryOpenError("LibraryOpenArgumentInvalid", "The Library address is invalid");
    let candidate;
    try { candidate = libraryPathFromArgument(argument); }
    catch { throw libraryOpenError("LibraryOpenArgumentInvalid", "The Library address is invalid"); }
    if (!candidate) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(argument) && /\.pitchlibrary(?:[/?#]|$)/i.test(argument)) {
        throw libraryOpenError("LibraryOpenArgumentInvalid", "The Library address is invalid");
      }
      continue;
    }
    if (!seen.has(candidate)) { candidates.push(candidate); seen.add(candidate); }
    if (candidates.length > MAX_LIBRARY_OPEN_ARGUMENTS) {
      throw libraryOpenError("LibraryOpenArgumentsOverflow", "Too many Libraries were requested at once");
    }
  }
  return candidates;
}

export function externalLibraryOpenMessage(error) {
  if (error?.code === "LibraryOpenArgumentInvalid") return "The requested Library address is invalid.";
  if (error?.code === "LibraryOpenArgumentsOverflow") return "Too many Libraries were requested at once.";
  if (error?.code === "LibraryOpenRequestCapacityExceeded" || error?.code === "LibraryOpenIntentCapacityExceeded") {
    return "Reference Library is already handling too many open requests.";
  }
  return "The requested Reference Library could not be opened.";
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

export async function canonicalLibraryCreationPath(candidate) {
  const libraryPath = libraryPathFromArgument(candidate);
  if (!libraryPath) throw new TypeError("Choose a .pitchlibrary package directory");
  const parent = await realpath(path.dirname(libraryPath));
  return path.join(parent, path.basename(libraryPath));
}

function libraryOpenError(code, message) { const error = new TypeError(message); error.code = code; return error; }
