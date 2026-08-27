import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";

import {
  IPC,
  assertAssetQuery,
  assertAssetUpdate,
  assertCollectionName,
  assertCollectionRename,
  assertJobQuery,
  assertMembership,
  assertOpenDecision,
  assertSession,
  assertUuid,
  assertWorkspacePreferencesPatch,
  assetResourceUrl,
} from "./bridge-contract.mjs";
import { CoreSupervisor } from "./core-supervisor.mjs";
import {
  ExternalLibraryOpenQueue,
  LibraryOpenIntentQueue,
  LibraryOpenQueue,
  replaceActiveLibraryTransaction,
} from "./library-open-queue.mjs";
import {
  assertPitchLibraryPackage,
  canonicalLibraryCreationPath,
  collectLibraryOpenArguments,
  externalLibraryOpenMessage,
} from "./library-open.mjs";
import { LibraryRecoveryCoordinator } from "./library-recovery.mjs";
import { denyAllSessionPermissions } from "./permission-policy.mjs";
import { rendererSafeCoreRestartEvent, rendererSafeError } from "./renderer-error.mjs";
import { authorizedResourceResponse } from "./resource-response.mjs";
import { isTrustedWorkspaceUrl, mimeForUiPath, resolveBundledUiPath } from "./resource-security.mjs";
import { forbiddenSandboxArgument, installNavigationGuards } from "./runtime-hardening.mjs";
import { readPreferences, writePreferences } from "./workspace-preferences.mjs";

protocol.registerSchemesAsPrivileged([
  { scheme: "pitchdog-ui", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: "pitchdog-asset", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(sourceDirectory, "workspace");
const core = new CoreSupervisor();
const recovery = new LibraryRecoveryCoordinator();
const libraryTransitions = new LibraryOpenQueue();
const externalLibraryOpens = new ExternalLibraryOpenQueue();
const openIntents = new LibraryOpenIntentQueue();
const startupArguments = process.argv.slice(1);
let mainWindow = null;
let preferencePath = null;
let rendererReady = false;
let automaticRecoveryEnabled = false;
let shuttingDown = false;
const pendingRendererEvents = [];

const forbiddenSwitch = forbiddenSandboxArgument(process.argv.slice(1));
if (forbiddenSwitch) {
  process.stderr.write("Reference Library requires the Chromium sandbox.\n");
  app.exit(78);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    void receiveExternalArguments(argv).catch(reportExternalOpenFailure);
  });
  app.on("open-file", (event, candidate) => {
    event.preventDefault();
    void receiveExternalArguments([candidate]).catch(reportExternalOpenFailure);
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => { void core.stop(); });
  app.whenReady().then(startApplication).catch(() => {
    deliver(rendererSafeCoreRestartEvent());
    app.exit(1);
  });
}

core.on("event", (event) => {
  if (event.event === "core_needs_restart") {
    recovery.markCoreFailure();
    deliver(rendererSafeCoreRestartEvent());
    if (automaticRecoveryEnabled && !shuttingDown) void performRecovery().catch(() => {});
    return;
  }
  if (RENDERER_EVENTS.has(event.event)) deliver(event);
});

async function startApplication() {
  registerProtocols();
  registerNamedOperations();
  preferencePath = path.join(app.getPath("userData"), "workspace-preferences.json");
  await core.start();
  recovery.markCoreReady();
  automaticRecoveryEnabled = true;
  createWindow();
  await receiveExternalArguments(startupArguments).catch(reportExternalOpenFailure);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#171715",
    show: false,
    webPreferences: {
      preload: path.join(sourceDirectory, "preload.mjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  denyAllSessionPermissions(mainWindow.webContents.session);
  installNavigationGuards(mainWindow.webContents, isTrustedWorkspaceUrl);
  mainWindow.webContents.once("did-finish-load", () => {
    rendererReady = true;
    for (const event of pendingRendererEvents.splice(0)) mainWindow?.webContents.send(IPC.event, event);
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  void mainWindow.loadURL("pitchdog-ui://app/index.html");
}

function registerProtocols() {
  protocol.handle("pitchdog-ui", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "app") return new Response("Not found", { status: 404 });
      const filePath = resolveBundledUiPath(workspaceRoot, url.pathname);
      return new Response(await readFile(filePath), { headers: {
        "Content-Type": mimeForUiPath(filePath),
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src pitchdog-asset: data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      } });
    } catch { return new Response("Not found", { status: 404 }); }
  });

  protocol.handle("pitchdog-asset", async (request) => {
    try {
      const url = new URL(request.url);
      const [assetId, profile, extra] = url.pathname.replace(/^\//, "").split("/");
      if (extra || !assetId || !profile) throw new Error("ResourceDenied");
      assertSession(recovery.activeSession, url.host);
      assertUuid(assetId, "assetId");
      assetResourceUrl({ sessionId: url.host, assetId, profile });
      const result = await core.authorizeResource(
        { sessionId: url.host, assetId, profile },
        { signal: request.signal },
      );
      const descriptor = expectResult(result, "resource_authorized");
      if (descriptor.sessionId !== url.host || descriptor.assetId !== assetId || descriptor.profile !== profile) {
        throw new Error("ResourceDenied");
      }
      return await authorizedResourceResponse(descriptor, { signal: request.signal });
    } catch (error) {
      if (error?.name === "AbortError") return new Response(null, { status: 499 });
      return new Response(error?.code === "SessionClosed" ? "Session closed" : "Resource denied", {
        status: error?.code === "SessionClosed" ? 410 : error?.code === "RenditionQueueFull" ? 503 : 403,
      });
    }
  });
}

function registerNamedOperations() {
  ipcMain.handle(IPC.createLibrary, trusted(async (_event, rawName) => {
    assertWritable();
    const name = assertLibraryName(rawName);
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: "New Reference Library", defaultPath: `${name}.pitchlibrary`, buttonLabel: "Create Library",
    });
    if (choice.canceled || !choice.filePath) return null;
    const selected = choice.filePath.endsWith(".pitchlibrary") ? choice.filePath : `${choice.filePath}.pitchlibrary`;
    const libraryPath = await canonicalLibraryCreationPath(selected);
    return libraryTransitions.run(() => replaceActiveLibrary({ libraryPath, createName: name }));
  }));

  ipcMain.handle(IPC.openLibrary, trusted(async () => {
    assertWritable();
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: "Open Reference Library", properties: ["openDirectory"], buttonLabel: "Open Library",
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const libraryPath = await assertPitchLibraryPackage(choice.filePaths[0]);
    return libraryTransitions.run(() => replaceActiveLibrary({ libraryPath }));
  }));

  ipcMain.handle(IPC.completeOpenIntent, trusted(async (_event, intentId, rawDecision) => {
    assertUuid(intentId, "intentId");
    const decision = assertOpenDecision(rawDecision);
    openIntents.activeCandidate(intentId);
    if (decision === "cancel") {
      openIntents.resolve(intentId, false);
      drainOpenIntent();
      return null;
    }
    assertWritable();
    const { candidate } = openIntents.resolve(intentId, true);
    const outcome = await libraryTransitions.runWithReplacementOutcome(
      () => Boolean(recovery.activeSession),
      () => replaceActiveLibrary({ libraryPath: candidate }),
    );
    drainOpenIntent();
    if (outcome.status === "opened") return outcome.value;
    throw outcome.error;
  }));

  ipcMain.handle(IPC.closeLibrary, trusted(async (_event, sessionId) => libraryTransitions.run(async () => {
    assertSession(recovery.activeSession, sessionId);
    expectResult(await core.request({ method: "close_library", params: { sessionId } }), "library_closed");
    recovery.clearLibrary();
  })));

  ipcMain.handle(IPC.chooseRoot, trusted(async (_event, sessionId) => {
    assertWritable(); assertSession(recovery.activeSession, sessionId);
    const choice = await chooseDirectory("Add Source Root", "Add Root");
    if (!choice) return null;
    const result = expectResult(await core.request({ method: "add_root", params: {
      sessionId, authorizedPath: choice, displayName: path.basename(choice),
    } }), "root_added");
    recovery.rememberRoot(result.rootId, choice);
    return { session: publicSession(recovery.activeSession), ...result };
  }));

  ipcMain.handle(IPC.listRoots, trusted(async (_event, sessionId) => {
    assertSession(recovery.activeSession, sessionId);
    return expectResult(await core.request({ method: "list_roots", params: { sessionId } }), "roots").items;
  }));

  ipcMain.handle(IPC.reauthorizeRoot, trusted(async (_event, sessionId, rootId) => {
    assertWritable(); assertSession(recovery.activeSession, sessionId); assertUuid(rootId, "rootId");
    const choice = await chooseDirectory("Reauthorize Source Root", "Reauthorize");
    if (!choice) return null;
    const root = expectResult(await core.request({ method: "bind_root", params: {
      sessionId, rootId, authorizedPath: choice,
    } }), "root_bound").root;
    recovery.rememberRoot(rootId, choice);
    return { session: publicSession(recovery.activeSession), root };
  }));

  ipcMain.handle(IPC.scanRoot, trusted(async (_event, sessionId, rootId) => {
    assertWritable(); assertSession(recovery.activeSession, sessionId); assertUuid(rootId, "rootId");
    return expectResult(await core.request({ method: "scan_root", params: { sessionId, rootId } }), "root_scan_started");
  }));

  ipcMain.handle(IPC.cancelJob, trusted(async (_event, sessionId, jobId) => {
    assertSession(recovery.activeSession, sessionId); assertUuid(jobId, "jobId");
    return expectResult(await core.request({ method: "cancel_job", params: { sessionId, jobId } }), "job_cancellation");
  }));

  ipcMain.handle(IPC.queryJobs, trusted(async (_event, input) => {
    assertJobQuery(input); assertSession(recovery.activeSession, input.sessionId);
    return expectResult(await core.request({ method: "query_jobs", params: input }), "job_page");
  }));

  ipcMain.handle(IPC.queryAssets, trusted(async (_event, input) => {
    assertAssetQuery(input); assertSession(recovery.activeSession, input.sessionId);
    return expectResult(await core.request({ method: "query_asset_index", params: {
      ...input, query: { ...input.query, search: input.query.search?.trim() || null },
    } }), "asset_page");
  }));

  ipcMain.handle(IPC.getAsset, trusted(async (_event, sessionId, assetId) => {
    assertSession(recovery.activeSession, sessionId); assertUuid(assetId, "assetId");
    return expectResult(await core.request({ method: "get_asset", params: { sessionId, assetId } }), "asset");
  }));

  ipcMain.handle(IPC.updateAsset, trusted(async (_event, input) => {
    assertWritable(); assertAssetUpdate(input); assertSession(recovery.activeSession, input.sessionId);
    return expectResult(await core.request({ method: "update_asset", params: input }), "asset_updated");
  }));

  ipcMain.handle(IPC.listCollections, trusted(async (_event, sessionId) => {
    assertSession(recovery.activeSession, sessionId);
    return expectResult(await core.request({ method: "list_collections", params: { sessionId } }), "collections").items;
  }));

  ipcMain.handle(IPC.createCollection, trusted(async (_event, sessionId, rawName) => {
    assertWritable(); assertSession(recovery.activeSession, sessionId);
    return expectResult(await core.request({ method: "create_collection", params: {
      sessionId, name: assertCollectionName(rawName),
    } }), "collection_updated").collection;
  }));

  ipcMain.handle(IPC.renameCollection, trusted(async (_event, sessionId, collectionId, expectedRevision, rawName) => {
    assertWritable(); assertSession(recovery.activeSession, sessionId);
    const input = assertCollectionRename(sessionId, collectionId, expectedRevision, rawName);
    return expectResult(await core.request({ method: "rename_collection", params: input }), "collection_updated").collection;
  }));

  ipcMain.handle(IPC.deleteCollection, trusted(async (_event, sessionId, collectionId) => {
    assertWritable(); assertSession(recovery.activeSession, sessionId); assertUuid(collectionId, "collectionId");
    expectResult(await core.request({ method: "delete_collection", params: { sessionId, collectionId } }), "collection_deleted");
  }));

  ipcMain.handle(IPC.setCollectionMembership, trusted(async (_event, input) => {
    assertWritable(); assertMembership(input); assertSession(recovery.activeSession, input.sessionId);
    return expectResult(await core.request({ method: "set_collection_membership", params: input }), "collection_membership_updated");
  }));

  ipcMain.handle(IPC.revealLocation, trusted(async (_event, sessionId, locationId) => {
    assertSession(recovery.activeSession, sessionId); assertUuid(locationId, "locationId");
    const location = expectResult(await core.request({ method: "resolve_location", params: { sessionId, locationId } }), "location_resolved");
    shell.showItemInFolder(location.nativePathForShell);
  }));

  ipcMain.handle(IPC.readPreferences, trusted(async () => readPreferences(preferencePath)));
  ipcMain.handle(IPC.writePreferences, trusted(async (_event, patch) => {
    assertWorkspacePreferencesPatch(patch);
    return writePreferences(preferencePath, patch);
  }));

  ipcMain.handle(IPC.capabilities, trusted(async (_event, sessionId) => {
    if (sessionId !== undefined) assertSession(recovery.activeSession, sessionId);
    return expectResult(await core.request({ method: "get_capabilities", params: { sessionId: sessionId ?? null } }), "capabilities").detail;
  }));
  ipcMain.handle(IPC.canonicalDump, trusted(async (_event, sessionId) => {
    assertSession(recovery.activeSession, sessionId);
    return expectResult(await core.request({ method: "canonical_dump", params: { sessionId } }), "canonical_dump").dump;
  }));
  ipcMain.handle(IPC.restartCore, trusted(async () => {
    return performRecovery();
  }));
}

async function performRecovery() {
  const opened = await recovery.recover({
    runTransition: (operation) => libraryTransitions.run(operation),
    restartCore: () => core.restart(),
    openLibrary: (libraryPath) => openCoreLibrary(libraryPath),
    bindRoot: (sessionId, rootId, authorizedPath) => bindCoreRoot(sessionId, rootId, authorizedPath),
    closeLibrary: async (sessionId) => {
      expectResult(await core.request({ method: "close_library", params: { sessionId } }), "library_closed");
    },
  });
  if (opened) deliver({ event: "library_opened", value: opened });
  drainOpenIntent();
  return opened;
}

async function replaceActiveLibrary({ libraryPath, createName }) {
  assertWritable();
  return replaceActiveLibraryTransaction({
    recovery,
    libraryPath,
    createName,
    closeLibrary: async (sessionId) => {
      expectResult(await core.request({ method: "close_library", params: { sessionId } }), "library_closed");
    },
    openLibrary: openCoreLibrary,
    createLibrary: async (target, name) => expectResult(await core.request({
      method: "create_library", params: { path: target, name },
    }), "session_opened"),
    bindRoot: bindCoreRoot,
    onOpened: (opened) => deliver({ event: "library_opened", value: opened }),
    onClosed: (sessionId) => deliver({ event: "library_closed", value: { sessionId } }),
  });
}

async function receiveExternalArguments(argv) {
  return externalLibraryOpens.run(async () => {
    const candidates = collectLibraryOpenArguments(argv);
    for (const candidate of candidates) {
      const canonical = await assertPitchLibraryPackage(candidate);
      if (recovery.snapshot()?.path === canonical) continue;
      if (!recovery.activeSession && !recovery.writesFrozen) {
        await libraryTransitions.run(() => replaceActiveLibrary({ libraryPath: canonical }));
      } else {
        openIntents.enqueue(canonical);
        drainOpenIntent();
      }
    }
    mainWindow?.focus();
  });
}

function reportExternalOpenFailure(error) {
  dialog.showErrorBox("Could not open Reference Library", externalLibraryOpenMessage(error));
}

function drainOpenIntent() {
  if (!mainWindow || recovery.writesFrozen) return;
  const intent = openIntents.requestNext();
  if (intent) deliver({ event: "library_open_requested", value: intent });
}

async function openCoreLibrary(libraryPath) {
  return expectResult(await core.request({ method: "open_library", params: { path: libraryPath } }), "session_opened");
}
async function bindCoreRoot(sessionId, rootId, authorizedPath) {
  return expectResult(await core.request({ method: "bind_root", params: { sessionId, rootId, authorizedPath } }), "root_bound").root;
}
async function chooseDirectory(title, buttonLabel) {
  const choice = await dialog.showOpenDialog(mainWindow, { title, properties: ["openDirectory"], buttonLabel });
  return choice.canceled || !choice.filePaths[0] ? null : path.resolve(choice.filePaths[0]);
}
function trusted(operation) {
  return async (event, ...args) => {
    if (!isTrustedWorkspaceUrl(event.senderFrame?.url ?? "")) throw rendererSafeError(new Error("UntrustedSender"));
    try { return await operation(event, ...args); }
    catch (error) { throw rendererSafeError(error); }
  };
}
function expectResult(result, expected) {
  if (result?.result !== expected) throw Object.assign(new Error("InvalidCoreResponse"), { code: "CoreFailure" });
  return result.value;
}
function assertLibraryName(name) {
  if (typeof name !== "string") throw new TypeError("Library name must be text");
  const normalized = name.trim();
  if (!normalized || [...normalized].length > 120 || /[\\/:*?"<>|]/.test(normalized)) {
    throw new TypeError("Library name contains unsupported characters");
  }
  return normalized;
}
function assertWritable() {
  if (recovery.writesFrozen) throw new Error("Reference Core must restart before writes continue");
}
function deliver(event) {
  if (!mainWindow || !rendererReady) {
    pendingRendererEvents.push(event);
    if (pendingRendererEvents.length > 100) pendingRendererEvents.shift();
    return;
  }
  mainWindow.webContents.send(IPC.event, event);
}
function publicSession(session) {
  if (!session) throw new Error("SessionClosed");
  const { sessionId, libraryId, schemaVersion, name } = session;
  return { sessionId, libraryId, schemaVersion, name };
}
const RENDERER_EVENTS = new Set([
  "root_state_changed", "scan_progress_changed", "assets_inserted", "asset_updated",
  "collections_changed", "job_updated",
]);
