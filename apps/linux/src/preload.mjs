import { contextBridge, ipcRenderer } from "electron";
import { IPC, assetResourceUrl } from "./bridge-contract.mjs";

const bridge = Object.freeze({
  version: 1,
  createLibrary: (name) => ipcRenderer.invoke(IPC.createLibrary, name),
  openLibrary: () => ipcRenderer.invoke(IPC.openLibrary),
  closeLibrary: (sessionId) => ipcRenderer.invoke(IPC.closeLibrary, sessionId),
  chooseRoot: (sessionId) => ipcRenderer.invoke(IPC.chooseRoot, sessionId),
  queryAssets: (input) => ipcRenderer.invoke(IPC.queryAssets, input),
  assetResourceUrl,
  revealLocation: (sessionId, locationId) =>
    ipcRenderer.invoke(IPC.revealLocation, sessionId, locationId),
  queryCapabilities: (sessionId) => ipcRenderer.invoke(IPC.capabilities, sessionId),
  canonicalDump: (sessionId) => ipcRenderer.invoke(IPC.canonicalDump, sessionId),
  restartCore: () => ipcRenderer.invoke(IPC.restartCore),
  subscribe: (listener) => {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.event, handler);
    return () => ipcRenderer.removeListener(IPC.event, handler);
  },
});

contextBridge.exposeInMainWorld("referenceLibrary", bridge);
