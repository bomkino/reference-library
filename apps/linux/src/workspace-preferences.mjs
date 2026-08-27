import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { assertWorkspacePreferences, assertWorkspacePreferencesPatch } from "./bridge-contract.mjs";

const DEFAULTS = Object.freeze({ interfaceScale: 1, thumbnailDensity: 220, previewZoom: 1 });
const MAXIMUM_PREFERENCES_BYTES = 8 * 1024;
const writeTails = new Map();

export async function readPreferences(filePath) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAXIMUM_PREFERENCES_BYTES) throw safePreferencesError();
    return assertWorkspacePreferences(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return { ...DEFAULTS };
    if (error?.preferencesSafe) throw error;
    throw safePreferencesError();
  } finally {
    await handle?.close();
  }
}

export function writePreferences(filePath, patch, hooks = {}) {
  const validatedPatch = assertWorkspacePreferencesPatch(patch);
  const previous = writeTails.get(filePath) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => writePreferencesAtomic(filePath, validatedPatch, hooks));
  let tracked;
  tracked = operation.finally(() => { if (writeTails.get(filePath) === tracked) writeTails.delete(filePath); });
  writeTails.set(filePath, tracked);
  return tracked;
}

async function writePreferencesAtomic(filePath, patch, { beforeRename } = {}) {
  const next = assertWorkspacePreferences({
    ...await readPreferences(filePath),
    ...patch,
  });
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.workspace-preferences-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile(`${JSON.stringify(next)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await beforeRename?.(temporary);
    await rename(temporary, filePath);
    const directoryHandle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    return next;
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    if (error?.preferencesSafe) throw error;
    throw safePreferencesError();
  }
}

function safePreferencesError() {
  const error = new Error("Workspace preferences could not be read or saved");
  error.code = "WorkspacePreferencesUnavailable";
  error.preferencesSafe = true;
  return error;
}

export const workspacePreferenceDefaults = DEFAULTS;
