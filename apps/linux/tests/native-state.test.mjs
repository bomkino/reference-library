import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  LibraryOpenIntentQueue,
  LibraryOpenQueue,
  ExternalLibraryOpenQueue,
  MAX_EXTERNAL_LIBRARY_OPEN_REQUESTS,
  MAX_LIBRARY_OPEN_INTENTS,
  replaceActiveLibraryTransaction,
} from "../src/library-open-queue.mjs";
import {
  assertPitchLibraryPackage,
  canonicalLibraryCreationPath,
  collectLibraryOpenArguments,
  externalLibraryOpenMessage,
} from "../src/library-open.mjs";
import { LibraryRecoveryCoordinator } from "../src/library-recovery.mjs";
import { rendererSafeError } from "../src/renderer-error.mjs";
import { forbiddenSandboxArgument } from "../src/runtime-hardening.mjs";
import { readPreferences, workspacePreferenceDefaults, writePreferences } from "../src/workspace-preferences.mjs";

const SESSION = "b4c27ebf-1dd5-4a03-9b8b-4eebd43947a0";
const ROOT = "45c16e93-f8e4-4fb9-970f-783ae9d34c18";

test("installed argv route accepts only package paths and file URLs", () => {
  assert.deepEqual(collectLibraryOpenArguments([
    "--flag",
    "/tmp/Project.pitchlibrary",
    "file:///tmp/Second.pitchlibrary",
    "/tmp/readme.txt",
  ]), ["/tmp/Project.pitchlibrary", "/tmp/Second.pitchlibrary"]);
  for (const candidate of [
    "https://example.test/Evil.pitchlibrary",
    "file://remote-host/tmp/Evil.pitchlibrary",
    "file:///tmp/%E0%A4%A.pitchlibrary",
  ]) {
    assert.throws(
      () => collectLibraryOpenArguments([candidate]),
      (error) => error.code === "LibraryOpenArgumentInvalid" && !error.message.includes(candidate),
    );
  }
  assert.throws(
    () => collectLibraryOpenArguments(Array.from({ length: 17 }, (_, index) => `/tmp/${index}.pitchlibrary`)),
    (error) => error.code === "LibraryOpenArgumentsOverflow",
  );
});

test("package-open validates real package children and canonicalizes parent aliases", async () => {
  await withTemporary("package-open", async (directory) => {
    const realParent = path.join(directory, "real");
    const aliasParent = path.join(directory, "alias");
    const library = path.join(realParent, "Project.pitchlibrary");
    await mkdir(library, { recursive: true });
    await writeFile(path.join(library, "manifest.json"), "{}\n");
    await writeFile(path.join(library, "library.sqlite"), "sqlite");
    await symlink(realParent, aliasParent);
    assert.equal(await assertPitchLibraryPackage(path.join(aliasParent, "Project.pitchlibrary")), library);
    assert.equal(
      await canonicalLibraryCreationPath(path.join(aliasParent, "New.pitchlibrary")),
      path.join(realParent, "New.pitchlibrary"),
    );
    await symlink(library, path.join(directory, "Linked.pitchlibrary"));
    await assert.rejects(assertPitchLibraryPackage(path.join(directory, "Linked.pitchlibrary")), /real package directory/);
  });
});

test("open intents are opaque, bounded, path-free, and strictly stale-rejected", () => {
  let sequence = 0;
  const intents = new LibraryOpenIntentQueue({ createId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  assert.equal(intents.enqueue("/secret/Proj\u0000ect.pitchlibrary"), true);
  const request = intents.requestNext();
  assert.equal(Object.hasOwn(request, "candidate"), false);
  assert.equal(request.displayName.includes("\u0000"), false);
  assert.throws(() => intents.activeCandidate("00000000-0000-4000-8000-999999999999"), /Stale/);
  assert.equal(intents.resolve(request.intentId, true).candidate.startsWith("/secret/"), true);
  for (let index = 0; index < MAX_LIBRARY_OPEN_INTENTS; index += 1) assert.equal(intents.enqueue(`/tmp/${index}.pitchlibrary`), true);
  assert.throws(
    () => intents.enqueue("/tmp/overflow.pitchlibrary"),
    (error) => error.code === "LibraryOpenIntentCapacityExceeded",
  );
});

test("external package-open batches are ordered, bounded, and report fixed path-free failures", async () => {
  const queue = new ExternalLibraryOpenQueue();
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = queue.run(async () => { order.push("first-start"); await gate; order.push("first-end"); });
  const second = queue.run(async () => { order.push("second"); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first-start"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);

  let releaseCapacity;
  const capacityGate = new Promise((resolve) => { releaseCapacity = resolve; });
  const pending = Array.from({ length: MAX_EXTERNAL_LIBRARY_OPEN_REQUESTS }, () =>
    queue.run(() => capacityGate));
  await assert.rejects(
    queue.run(async () => {}),
    (error) => error.code === "LibraryOpenRequestCapacityExceeded",
  );
  releaseCapacity();
  await Promise.all(pending);

  for (const error of [
    { code: "LibraryOpenArgumentInvalid", message: "/private/secret" },
    { code: "LibraryOpenArgumentsOverflow" },
    { code: "LibraryOpenIntentCapacityExceeded" },
    new Error("/private/Project.pitchlibrary"),
  ]) {
    assert.doesNotMatch(externalLibraryOpenMessage(error), /private|secret|Project/);
  }
});

test("replacement state is sampled inside the serialized transition", async () => {
  const transitions = new LibraryOpenQueue();
  let release;
  let active = false;
  const first = transitions.run(() => new Promise((resolve) => { release = () => { active = true; resolve(); }; }));
  const second = transitions.runWithReplacementOutcome(() => active, async () => "opened");
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await first;
  assert.deepEqual(await second, { status: "opened", value: "opened", replacedActiveLibrary: true });
});

test("a failed target open reopens the previous Library and rebinds its Roots", async () => {
  const recovery = readyRecovery();
  const rebound = [];
  const openedEvents = [];
  await assert.rejects(replaceActiveLibraryTransaction({
    recovery,
    libraryPath: "/private/New.pitchlibrary",
    closeLibrary: async () => {},
    openLibrary: async (candidate) => {
      if (candidate.endsWith("New.pitchlibrary")) throw new Error("target failed");
      return opened("b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1");
    },
    createLibrary: async () => assert.fail("unexpected create"),
    bindRoot: async (...values) => rebound.push(values),
    onOpened: (value) => openedEvents.push(value.sessionId),
  }), /target failed/);
  assert.equal(recovery.activeSession.sessionId, "b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1");
  assert.deepEqual(rebound, [["b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1", ROOT, "/private/Stills"]]);
  assert.deepEqual(openedEvents, ["b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1"]);
});

test("failed target and rollback emit an honest closed session", async () => {
  const recovery = readyRecovery();
  const closedEvents = [];
  await assert.rejects(replaceActiveLibraryTransaction({
    recovery,
    libraryPath: "/private/New.pitchlibrary",
    closeLibrary: async () => {},
    openLibrary: async () => { throw new Error("open failed"); },
    createLibrary: async () => assert.fail("unexpected create"),
    bindRoot: async () => {},
    onClosed: (sessionId) => closedEvents.push(sessionId),
  }), /open failed/);
  assert.equal(recovery.activeSession, null);
  assert.deepEqual(closedEvents, [SESSION]);
});

test("recovery reopens one Library and rebinds only retained Roots", async () => {
  const recovery = new LibraryRecoveryCoordinator();
  recovery.markCoreReady();
  recovery.adoptSession(opened(SESSION), "/private/Project.pitchlibrary");
  recovery.rememberRoot(ROOT, "/private/Stills");
  recovery.markCoreFailure();
  const calls = [];
  const nextSession = "b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1";
  const result = await recovery.recover({
    restartCore: async () => calls.push("restart"),
    openLibrary: async (libraryPath) => { calls.push(["open", libraryPath]); return opened(nextSession); },
    bindRoot: async (sessionId, rootId, authorizedPath) => calls.push(["bind", sessionId, rootId, authorizedPath]),
  });
  assert.equal(result.sessionId, nextSession);
  assert.equal(recovery.writesFrozen, false);
  assert.deepEqual(calls, [
    "restart",
    ["open", "/private/Project.pitchlibrary"],
    ["bind", nextSession, ROOT, "/private/Stills"],
  ]);
});

test("an unavailable Root does not abort Library recovery or discard its authority target", async () => {
  const recovery = new LibraryRecoveryCoordinator();
  recovery.markCoreReady();
  recovery.adoptSession(opened(SESSION), "/private/Project.pitchlibrary");
  recovery.rememberRoot(ROOT, "/private/Stills");
  const availableRoot = "2c5b5df0-6eb5-43ec-a57d-0fbd2eb4ca40";
  recovery.rememberRoot(availableRoot, "/private/Available");
  const rebound = [];
  const result = await recovery.recover({
    restartCore: async () => {},
    openLibrary: async () => opened("b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1"),
    bindRoot: async (_sessionId, rootId) => {
      if (rootId === ROOT) throw Object.assign(new Error("/private/Stills"), { code: "RootPermissionRequired" });
      rebound.push(rootId);
    },
  });
  assert.equal(result.sessionId, "b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1");
  assert.equal(recovery.writesFrozen, false);
  assert.deepEqual(recovery.unavailableRootIds, [ROOT]);
  assert.deepEqual(rebound, [availableRoot]);
  assert.equal(recovery.retainedRootCount, 2);
});

test("a second Core failure during Root bind closes provisional recovery and freezes writes", async () => {
  const recovery = new LibraryRecoveryCoordinator();
  recovery.markCoreReady();
  recovery.adoptSession(opened(SESSION), "/private/Project.pitchlibrary");
  recovery.rememberRoot(ROOT, "/private/Stills");
  const closed = [];
  await assert.rejects(recovery.recover({
    restartCore: async () => {},
    openLibrary: async () => opened("b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1"),
    bindRoot: async () => { recovery.markCoreFailure(); throw new Error("transport stopped"); },
    closeLibrary: async (sessionId) => closed.push(sessionId),
  }), /failed again/);
  assert.equal(recovery.activeSession, null);
  assert.equal(recovery.writesFrozen, true);
  assert.deepEqual(closed, ["b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1"]);
});

test("recovery is single-flight and the complete operation occupies one transition", async () => {
  const recovery = readyRecovery();
  const transitions = new LibraryOpenQueue();
  const calls = [];
  let releaseTransition;
  const preceding = transitions.run(() => new Promise((resolve) => {
    calls.push("preceding"); releaseTransition = resolve;
  }));
  const options = {
    runTransition: (operation) => transitions.run(operation),
    restartCore: async () => calls.push("restart"),
    openLibrary: async () => { calls.push("open"); return opened("b4c27ebf-1dd5-4a03-9b8b-4eebd43947a1"); },
    bindRoot: async () => calls.push("bind"),
  };
  const first = recovery.recover(options);
  const second = recovery.recover(options);
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["preceding"]);
  releaseTransition();
  await preceding;
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["preceding", "restart", "open", "bind"]);
});

test("host preferences are independent, partial, atomic, and reject symlink reads", async () => {
  await withTemporary("preferences", async (directory) => {
    const file = path.join(directory, "preferences.json");
    assert.deepEqual(await readPreferences(file), workspacePreferenceDefaults);
    assert.deepEqual(await writePreferences(file, { interfaceScale: 1.25, previewZoom: 2 }), {
      interfaceScale: 1.25, thumbnailDensity: 220, previewZoom: 2,
    });
    assert.deepEqual(await writePreferences(file, { thumbnailDensity: 300 }), {
      interfaceScale: 1.25, thumbnailDensity: 300, previewZoom: 2,
    });
    const [scaled, zoomed] = await Promise.all([
      writePreferences(file, { interfaceScale: 1.5 }),
      writePreferences(file, { previewZoom: 3 }),
    ]);
    assert.equal(scaled.interfaceScale, 1.5);
    assert.deepEqual(zoomed, { interfaceScale: 1.5, thumbnailDensity: 300, previewZoom: 3 });
    assert.deepEqual(await readPreferences(file), zoomed);
    await assert.rejects(
      writePreferences(file, { previewZoom: 4 }, { beforeRename: async () => { throw new Error("injected"); } }),
      (error) => error.code === "WorkspacePreferencesUnavailable" && !error.message.includes(directory),
    );
    assert.deepEqual(await readPreferences(file), zoomed);
    const link = path.join(directory, "preferences-link.json");
    await symlink(file, link);
    await assert.rejects(readPreferences(link), (error) =>
      error.code === "WorkspacePreferencesUnavailable" && !error.message.includes(directory));
  });
});

test("sandbox bypass flags are refused exactly", () => {
  assert.equal(forbiddenSandboxArgument(["--no-sandbox"]), "--no-sandbox");
  assert.equal(forbiddenSandboxArgument(["--disable-setuid-sandbox=true"]), "--disable-setuid-sandbox=true");
  assert.equal(forbiddenSandboxArgument(["--safe", "/tmp/A.pitchlibrary"]), null);
});

test("integrity failures are fixed, preserved, and path-free", () => {
  for (const code of [
    "LibraryDatabaseIntegrityInvalid", "LibraryMigrationLedgerInvalid", "LibraryIntegrityFailedPreserved",
  ]) {
    const result = rendererSafeError(Object.assign(new Error("/private/Project.pitchlibrary"), { code }));
    assert.match(result.message, /preserved unchanged/);
    assert.doesNotMatch(result.message, /private/);
  }
});

test("job query states exclude the cancellation command disposition", async () => {
  const { assertJobQuery } = await import("../src/bridge-contract.mjs");
  assert.throws(() => assertJobQuery({
    sessionId: SESSION, offset: 0, limit: 10,
    query: { rootId: null, states: ["cancellation_requested"] },
  }), /Unknown states value/);
});

function opened(sessionId) {
  return { sessionId, libraryId: "00000000-0000-4000-8000-000000000001", schemaVersion: 3, name: "Project" };
}
function readyRecovery() {
  const recovery = new LibraryRecoveryCoordinator();
  recovery.markCoreReady();
  recovery.adoptSession(opened(SESSION), "/private/Project.pitchlibrary");
  recovery.rememberRoot(ROOT, "/private/Stills");
  return recovery;
}
async function withTemporary(label, operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `reference-native-${label}-`));
  try { await operation(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
