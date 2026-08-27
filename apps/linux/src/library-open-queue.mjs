import { randomUUID } from "node:crypto";
import path from "node:path";

export class LibraryOpenQueue {
  #tail = Promise.resolve();
  run(operation) {
    if (typeof operation !== "function") return Promise.reject(new TypeError("Library transition must be a function"));
    const result = this.#tail.then(() => operation());
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
  runWithReplacementOutcome(isReplacing, operation) {
    if (typeof isReplacing !== "function" || typeof operation !== "function") {
      return Promise.reject(new TypeError("Library transition probes must be functions"));
    }
    return this.run(async () => {
      const replacedActiveLibrary = Boolean(isReplacing());
      try { return { status: "opened", value: await operation(), replacedActiveLibrary }; }
      catch (error) { return { status: "failed", error, replacedActiveLibrary }; }
    });
  }
}

export async function replaceActiveLibraryTransaction({
  recovery,
  libraryPath,
  createName,
  closeLibrary,
  openLibrary,
  createLibrary,
  bindRoot,
  onOpened = () => {},
  onClosed = () => {},
}) {
  const previous = recovery.snapshot();
  if (!createName && previous?.path === libraryPath) return rendererSession(previous.session);
  if (previous) {
    await closeLibrary(previous.session.sessionId);
    recovery.clearLibrary();
  }
  try {
    const opened = createName
      ? await createLibrary(libraryPath, createName)
      : await openLibrary(libraryPath);
    recovery.adoptSession(opened, libraryPath);
    onOpened(opened);
    return opened;
  } catch (originalError) {
    if (previous) {
      let provisional = null;
      try {
        provisional = await openLibrary(previous.path);
        for (const [rootId, authorizedPath] of previous.roots) {
          await bindRoot(provisional.sessionId, rootId, authorizedPath);
        }
        recovery.adoptSession(provisional, previous.path, previous.roots);
        onOpened(provisional);
      } catch {
        if (provisional) await closeLibrary(provisional.sessionId).catch(() => {});
        recovery.clearLibrary();
        onClosed(previous.session.sessionId);
      }
    }
    throw originalError;
  }
}

export const MAX_LIBRARY_OPEN_INTENTS = 16;
export class LibraryOpenIntentQueue {
  #active = null; #pending = []; #createId;
  constructor({ createId = randomUUID } = {}) { this.#createId = createId; }
  get count() { return this.#pending.length + (this.#active ? 1 : 0); }
  enqueue(candidate) {
    if (typeof candidate !== "string" || !candidate) throw new TypeError("Library open candidate must be a native path");
    if (this.count >= MAX_LIBRARY_OPEN_INTENTS) return false;
    this.#pending.push({ intentId: this.#createId(), displayName: safeDisplayName(candidate), candidate });
    return true;
  }
  requestNext() {
    if (this.#active || this.#pending.length === 0) return null;
    this.#active = this.#pending.shift();
    return publicIntent(this.#active);
  }
  activeRequest() { return this.#active ? publicIntent(this.#active) : null; }
  activeCandidate(intentId) { return this.#require(intentId).candidate; }
  replaceActiveCandidate(intentId, candidate) {
    this.#require(intentId);
    this.#active = { ...this.#active, candidate, displayName: safeDisplayName(candidate) };
    return publicIntent(this.#active);
  }
  resolve(intentId, proceed) {
    if (typeof proceed !== "boolean") throw new TypeError("proceed must be boolean");
    const active = this.#require(intentId);
    this.#active = null;
    return { candidate: active.candidate, proceed };
  }
  #require(intentId) {
    if (!this.#active || this.#active.intentId !== intentId) throw new Error("LibraryOpenIntentStale");
    return this.#active;
  }
}
function publicIntent(intent) { return { intentId: intent.intentId, displayName: intent.displayName }; }
function rendererSession(session) {
  const { sessionId, libraryId, schemaVersion, name } = session;
  return { sessionId, libraryId, schemaVersion, name };
}
function safeDisplayName(candidate) {
  const value = [...path.basename(candidate)]
    .filter((character) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character))
    .slice(0, 120).join("");
  return value || "Reference Library";
}
