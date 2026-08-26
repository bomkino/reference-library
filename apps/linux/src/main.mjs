import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
} from "electron";

import { CoreSupervisor } from "./core-supervisor.mjs";
import {
  IPC,
  assertAssetQuery,
  assertSession,
  assertUuid,
  assetResourceUrl,
} from "./bridge-contract.mjs";
import {
  isTrustedWorkspaceUrl,
  mimeForUiPath,
  resolveBundledUiPath,
} from "./resource-security.mjs";

protocol.registerSchemesAsPrivileged([
  { scheme: "pitchdog-ui", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: "pitchdog-asset", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(sourceDirectory, "workspace");
const core = new CoreSupervisor();
let mainWindow = null;
let activeSession = null;
let writesFrozen = false;

app.setName("Reference Library");
app.whenReady().then(async () => {
  registerProtocols();
  registerNamedOperations();
  await core.start();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => void core.stop());

core.on("event", (event) => {
  if (event.event === "core_needs_restart") writesFrozen = true;
  mainWindow?.webContents.send(IPC.event, event);
});

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
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedWorkspaceUrl(url)) event.preventDefault();
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
      const bytes = await readFile(filePath);
      return new Response(bytes, {
        headers: {
          "Content-Type": mimeForUiPath(filePath),
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src pitchdog-asset: data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  protocol.handle("pitchdog-asset", async (request) => {
    try {
      const url = new URL(request.url);
      const [assetId, profile, extra] = url.pathname.replace(/^\//, "").split("/");
      if (extra || !assetId || !profile) throw new Error("Invalid resource grammar");
      assertSession(activeSession, url.host);
      assertUuid(assetId, "assetId");
      assetResourceUrl({ sessionId: url.host, assetId, profile });
      const result = await core.request({
        method: "authorize_resource",
        params: { sessionId: url.host, assetId, profile },
      });
      const descriptor = expectResult(result, "resource_authorized");
      if (
        descriptor.sessionId !== url.host ||
        descriptor.assetId !== assetId ||
        descriptor.profile !== profile
      ) {
        throw new Error("Resource authorization mismatch");
      }
      const bytes = await readFile(descriptor.nativePathForHandler);
      if (bytes.length !== descriptor.contentLength) throw new Error("Source changed during read");
      return new Response(bytes, {
        headers: {
          "Content-Type": descriptor.mimeType,
          "Content-Length": String(bytes.length),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      const status = error?.code === "SessionClosed" ? 410 : 403;
      return new Response(status === 410 ? "Session closed" : "Resource denied", { status });
    }
  });
}

function registerNamedOperations() {
  ipcMain.handle(IPC.createLibrary, trusted(async (_event, name) => {
    assertWritable();
    const safeName = assertLibraryName(name);
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: "New Reference Library",
      defaultPath: `${safeName}.pitchlibrary`,
      buttonLabel: "Create Library",
    });
    if (choice.canceled || !choice.filePath) return null;
    const libraryPath = choice.filePath.endsWith(".pitchlibrary")
      ? choice.filePath
      : `${choice.filePath}.pitchlibrary`;
    const opened = expectResult(
      await core.request({ method: "create_library", params: { path: libraryPath, name: safeName } }),
      "session_opened",
    );
    activeSession = { ...opened, path: libraryPath };
    return opened;
  }));

  ipcMain.handle(IPC.openLibrary, trusted(async () => {
    assertWritable();
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: "Open Reference Library",
      properties: ["openDirectory"],
      buttonLabel: "Open Library",
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const libraryPath = choice.filePaths[0];
    if (!libraryPath.endsWith(".pitchlibrary")) throw new Error("Choose a .pitchlibrary package");
    const opened = expectResult(
      await core.request({ method: "open_library", params: { path: libraryPath } }),
      "session_opened",
    );
    activeSession = { ...opened, path: libraryPath };
    return opened;
  }));

  ipcMain.handle(IPC.closeLibrary, trusted(async (_event, sessionId) => {
    assertSession(activeSession, sessionId);
    await core.request({ method: "close_library", params: { sessionId } });
    activeSession = null;
  }));

  ipcMain.handle(IPC.chooseRoot, trusted(async (_event, sessionId) => {
    assertWritable();
    assertSession(activeSession, sessionId);
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: "Add Source Root",
      properties: ["openDirectory"],
      buttonLabel: "Add Root",
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const rootPath = choice.filePaths[0];
    return expectResult(
      await core.request({
        method: "add_root",
        params: { sessionId, authorizedPath: rootPath, displayName: path.basename(rootPath) },
      }),
      "root_added",
    );
  }));

  ipcMain.handle(IPC.queryAssets, trusted(async (_event, input) => {
    assertAssetQuery(input);
    assertSession(activeSession, input.sessionId);
    return expectResult(
      await core.request({ method: "query_assets", params: input }),
      "asset_page",
    );
  }));

  ipcMain.handle(IPC.revealLocation, trusted(async (_event, sessionId, locationId) => {
    assertSession(activeSession, sessionId);
    assertUuid(locationId, "locationId");
    const location = expectResult(
      await core.request({ method: "resolve_location", params: { sessionId, locationId } }),
      "location_resolved",
    );
    shell.showItemInFolder(location.nativePathForShell);
  }));

  ipcMain.handle(IPC.capabilities, trusted(async (_event, sessionId) => {
    if (sessionId !== undefined) assertSession(activeSession, sessionId);
    const capabilities = expectResult(
      await core.request({ method: "get_capabilities", params: { sessionId: sessionId ?? null } }),
      "capabilities",
    );
    return capabilities.detail;
  }));

  ipcMain.handle(IPC.canonicalDump, trusted(async (_event, sessionId) => {
    assertSession(activeSession, sessionId);
    return expectResult(
      await core.request({ method: "canonical_dump", params: { sessionId } }),
      "canonical_dump",
    ).dump;
  }));

  ipcMain.handle(IPC.restartCore, trusted(async () => {
    const previous = activeSession;
    await core.restart();
    writesFrozen = false;
    if (previous?.path) {
      const opened = expectResult(
        await core.request({ method: "open_library", params: { path: previous.path } }),
        "session_opened",
      );
      activeSession = { ...opened, path: previous.path };
      return opened;
    }
    activeSession = null;
    return null;
  }));
}

function trusted(operation) {
  return (event, ...args) => {
    if (!isTrustedWorkspaceUrl(event.senderFrame?.url ?? "")) {
      throw new Error("Untrusted workspace sender");
    }
    return operation(event, ...args);
  };
}

function expectResult(result, expected) {
  if (result?.result !== expected) throw new Error(`Unexpected Reference Core result: ${result?.result}`);
  return result.value;
}

function assertLibraryName(name) {
  if (typeof name !== "string") throw new TypeError("Library name must be text");
  const normalized = name.trim();
  if (!normalized || normalized.length > 120 || /[\\/:*?"<>|]/.test(normalized)) {
    throw new TypeError("Library name contains unsupported characters");
  }
  return normalized;
}

function assertWritable() {
  if (writesFrozen) throw new Error("Reference Core must restart before writes continue");
}
