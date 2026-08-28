import { contextBridge, ipcRenderer } from "electron";
import { IPC, assetResourceUrl, unwrapAssetQueryIpcResult } from "./bridge-contract.mjs";

const listeners = new Set();
const pendingEvents = [];
ipcRenderer.on(IPC.event, (_event, payload) => {
  if (listeners.size === 0) {
    pendingEvents.push(payload);
    if (pendingEvents.length > 100) pendingEvents.shift();
    return;
  }
  for (const listener of [...listeners]) listener(payload);
});

const bridge = Object.freeze({
  version: 4,
  createLibrary: (name) => ipcRenderer.invoke(IPC.createLibrary, name),
  openLibrary: () => ipcRenderer.invoke(IPC.openLibrary),
  completeOpenIntent: (intentId, decision) => ipcRenderer.invoke(IPC.completeOpenIntent, intentId, decision),
  closeLibrary: (sessionId) => ipcRenderer.invoke(IPC.closeLibrary, sessionId),
  chooseRoot: (sessionId) => ipcRenderer.invoke(IPC.chooseRoot, sessionId),
  listRoots: (sessionId) => ipcRenderer.invoke(IPC.listRoots, sessionId),
  reauthorizeRoot: (sessionId, rootId) => ipcRenderer.invoke(IPC.reauthorizeRoot, sessionId, rootId),
  scanRoot: (sessionId, rootId) => ipcRenderer.invoke(IPC.scanRoot, sessionId, rootId),
  cancelJob: (sessionId, jobId) => ipcRenderer.invoke(IPC.cancelJob, sessionId, jobId),
  queryJobs: (input) => ipcRenderer.invoke(IPC.queryJobs, input),
  queryAssets: (input) => ipcRenderer.invoke(IPC.queryAssets, input).then(unwrapAssetQueryIpcResult),
  getAsset: (sessionId, assetId) => ipcRenderer.invoke(IPC.getAsset, sessionId, assetId),
  updateAsset: (input) => ipcRenderer.invoke(IPC.updateAsset, input),
  listCollections: (sessionId) => ipcRenderer.invoke(IPC.listCollections, sessionId),
  createCollection: (sessionId, name) => ipcRenderer.invoke(IPC.createCollection, sessionId, name),
  renameCollection: (sessionId, collectionId, expectedRevision, name) =>
    ipcRenderer.invoke(IPC.renameCollection, sessionId, collectionId, expectedRevision, name),
  deleteCollection: (sessionId, collectionId) => ipcRenderer.invoke(IPC.deleteCollection, sessionId, collectionId),
  setCollectionMembership: (input) => ipcRenderer.invoke(IPC.setCollectionMembership, input),
  assetResourceUrl,
  revealLocation: (sessionId, locationId) => ipcRenderer.invoke(IPC.revealLocation, sessionId, locationId),
  openLocation: (sessionId, locationId) => ipcRenderer.invoke(IPC.openLocation, sessionId, locationId),
  copyLocationPath: (sessionId, locationId) => ipcRenderer.invoke(IPC.copyLocationPath, sessionId, locationId),
  readPreferences: () => ipcRenderer.invoke(IPC.readPreferences),
  writePreferences: (patch) => ipcRenderer.invoke(IPC.writePreferences, patch),
  queryCapabilities: (sessionId) => ipcRenderer.invoke(IPC.capabilities, sessionId),
  restartCore: () => ipcRenderer.invoke(IPC.restartCore),
  subscribe: (listener) => {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    listeners.add(listener);
    for (const payload of pendingEvents.splice(0)) listener(payload);
    return () => listeners.delete(listener);
  },
});

contextBridge.exposeInMainWorld("referenceLibrary", bridge);
