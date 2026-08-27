// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_VERSION,
  type AssetDetail,
  type AssetPage,
  type AssetQuery,
  type AssetSummary,
  type CollectionSummary,
  type ReferenceWorkspaceBridge,
  type RootSummary,
  type SessionOpened,
  type WorkspaceEvent,
} from "@pitchdog/reference-bridge";
import { App } from "./app";

const SESSION: SessionOpened = { sessionId: "session-1", libraryId: "library-1", schemaVersion: 1, name: "Film References" };
const ASSETS: AssetSummary[] = [
  asset("asset-1", "A-frame.jpg"),
  asset("asset-2", "B-frame.jpg"),
  asset("asset-3", "Offline.jpg", "offline_volume"),
  asset("asset-4", "Unreadable.jpg", "unreadable"),
  asset("asset-5", "Missing.jpg", "missing"),
];

describe("V1 keyboard daily-use seams", () => {
  let host: HTMLDivElement;
  let root: Root;
  let harness: BridgeHarness;

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0) as unknown as number;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 900 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    harness = new BridgeHarness();
    window.referenceLibrary = harness.bridge;
    await act(async () => { root.render(<App />); await settle(); });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete window.referenceLibrary;
  });

  it("operates Root, query, curation, Preview, zoom and reveal controls through keyboard events", async () => {
    button("New Library").focus();
    await press("Tab");
    expect(document.activeElement).toBe(button("Open Library"));
    await press("Tab", true);
    expect(document.activeElement).toBe(button("New Library"));
    await press("Enter");
    await waitFor(() => expect(text()).toContain("Film References"));
    expect(host.querySelector('[aria-label*="offline_volume"]')).not.toBeNull();
    expect(host.querySelector('[aria-label*="unreadable"]')).not.toBeNull();
    expect(host.querySelector('[aria-label*="missing"]')).not.toBeNull();
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-label")).toContain("5 assets");
    expect(host.querySelector(".selection-announcer")?.getAttribute("aria-live")).toBe("polite");

    await selectByKeyboard(select("Interface"), "1.25");
    const density = input("Thumbnail density");
    await changeInputByKeyboard(density, "240", "ArrowRight");
    expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe("1.25");
    expect(density.value).toBe("240");
    expect(harness.calls.writePreferences).toContainEqual({ interfaceScale: 1.25 });
    expect(harness.calls.writePreferences).toContainEqual({ thumbnailDensity: 240 });

    await focusAndPress(button("Reauthorize"), " ");
    expect(harness.calls.reauthorizeRoot).toBe(1);
    await focusAndPress(button("Rescan"), "Enter");
    expect(harness.calls.scanRoot).toBe(1);
    await focusAndPress(button("Cancel"), " ");
    expect(harness.calls.cancelJob).toBe(1);

    const search = input("Search");
    await typeByKeyboard(search, "frame");
    await focusAndPress(search, "Enter");
    await waitFor(() => expect(harness.lastQuery?.search).toBe("frame"));
    await selectByKeyboard(select("Root"), "root-1");
    await selectByKeyboard(select("Review"), "keep");
    await selectByKeyboard(select("Availability"), "present");
    await selectByKeyboard(select("Sort"), "name_descending");
    expect(harness.lastQuery).toMatchObject({ rootId: "root-1", reviewStates: ["keep"], availability: ["present"], sort: "name_descending" });

    const firstCard = host.querySelector<HTMLElement>('[data-asset-id="asset-1"]')!;
    firstCard.focus();
    await press("ArrowRight");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-asset-id")).toBe("asset-2"));
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector(".selection-announcer")?.textContent).toContain("B-frame.jpg");
    await press("Enter");
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button("Fit").getAttribute("aria-pressed")).toBe("true");
    await focusAndPress(button("Zoom in"), " ");
    expect(text()).toContain("200%");
    expect(harness.calls.writePreferences).toContainEqual({ previewZoom: 2 });
    expect(select("Interface").value).toBe("1.25");
    expect(input("Thumbnail density").value).toBe("240");
    await press("Escape");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.getAttribute("data-asset-id")).toBe("asset-2");

    await waitFor(() => expect(input("Title")).not.toBeNull());
    await selectByKeyboard(select("Review", host.querySelector(".inspector")!), "keep");
    await focusAndPress(button("Save", host.querySelector(".inspector")!), "Enter");
    expect(harness.calls.updateAsset).toBe(1);
    expect(text()).toContain("Stills/B-frame.jpg");
    await focusAndPress(button("Reveal Source"), " ");
    expect(harness.calls.revealLocation).toBe(1);
  });

  it("guards dirty selection, query, Collection deletion and external open intent with save/discard/cancel", async () => {
    await focusAndPress(button("New Library"), "Enter");
    await waitFor(() => expect(host.querySelector('[data-asset-id="asset-1"]')).not.toBeNull());
    await focusAndPress(host.querySelector<HTMLElement>('[data-asset-id="asset-1"]')!, " ");
    await waitFor(() => expect(input("Title")).not.toBeNull());
    await typeByKeyboard(input("Title"), " draft");

    const second = host.querySelector<HTMLElement>('[data-asset-id="asset-2"]')!;
    await focusAndPress(second, " ");
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(button("Cancel"));
    await press("Tab");
    expect(document.activeElement).toBe(button("Save and Continue"));
    await press("Tab", true);
    expect(document.activeElement).toBe(button("Cancel"));
    await press("Escape");
    expect(document.activeElement).toBe(second);
    expect(input("Title").value).toContain("draft");

    await focusAndPress(button("Selects1"), " ");
    await focusAndPress(button("Discard and Continue"), "Enter");
    expect(input("Title").value).not.toContain("draft");
    expect(harness.lastQuery?.collectionId).toBe("collection-1");
    expect(host.querySelector(".selection-announcer")?.textContent).toContain("A-frame.jpg");

    await typeByKeyboard(input("Title"), " saved");
    await act(async () => harness.emit({ event: "library_open_requested", value: { intentId: "intent-1", displayName: "Other Library" } }));
    expect(text()).toContain("Open “Other Library” would leave the current draft.");
    await focusAndPress(button("Save and Continue"), "Enter");
    expect(harness.calls.completeOpenIntent).toEqual([["intent-1", "save"]]);
    expect(harness.calls.updateAsset).toBe(1);
  });

  it("opens an existing Library, creates a Collection and updates membership without losing selection", async () => {
    await focusAndPress(button("Open Library"), "Enter");
    await waitFor(() => expect(text()).toContain("Film References"));
    expect(harness.calls.openLibrary).toBe(1);
    const newCollection = input("New Collection");
    await typeByKeyboard(newCollection, "Mood");
    await focusAndPress(newCollection, "Enter");
    await waitFor(() => expect(text()).toContain("Mood"));
    expect(harness.calls.createCollection).toBe(1);
    await focusAndPress(host.querySelector<HTMLElement>('[data-asset-id="asset-1"]')!, " ");
    await waitFor(() => expect(host.querySelector(".membership")).not.toBeNull());
    const membership = [...host.querySelectorAll<HTMLInputElement>('.membership input[type="checkbox"]')].find((item) => item.closest("label")?.textContent?.includes("Mood"))!;
    await focusAndPress(membership, " ");
    expect(harness.calls.setCollectionMembership).toBe(1);
    expect(host.querySelector(".selection-announcer")?.textContent).toContain("A-frame.jpg");
  });

  it("atomically adopts Root authority replacement sessions without orphaning selection or drafts", async () => {
    await focusAndPress(button("New Library"), "Enter");
    await waitFor(() => expect(host.querySelector('[data-asset-id="asset-1"]')).not.toBeNull());
    await focusAndPress(host.querySelector<HTMLElement>('[data-asset-id="asset-1"]')!, " ");
    await waitFor(() => expect(input("Title")).not.toBeNull());
    await typeByKeyboard(input("Title"), " preserved draft");

    await focusAndPress(button("Add"), "Enter");
    await waitFor(() => expect(harness.authoritySession.sessionId).toBe("session-authority-1"));
    expect(input("Title").value).toContain("preserved draft");
    expect(host.querySelector(".selection-announcer")?.textContent).toContain("A-frame.jpg");

    await focusAndPress(button("Reauthorize"), "Enter");
    await waitFor(() => expect(harness.authoritySession.sessionId).toBe("session-authority-2"));
    expect(input("Title").value).toContain("preserved draft");
    expect(harness.calls.staleFollowUps).toBe(0);
    await focusAndPress(button("Save", host.querySelector(".inspector")!), "Enter");
    expect(harness.calls.updateSessions.at(-1)).toBe("session-authority-2");
  });

  it("renders distinct no-Library, empty-Library and filtered no-results states", async () => {
    expect(text()).toContain("Your project’s visual memory.");
    harness.assets = [];
    await focusAndPress(button("New Library"), "Enter");
    await waitFor(() => expect(text()).toContain("This Library has no Assets yet"));
    harness.assets = [...ASSETS];
    const search = input("Search");
    await replaceByKeyboard(search, "no-match");
    await focusAndPress(search, "Enter");
    await waitFor(() => expect(text()).toContain("No Assets match this view"));
  });

  it("recovers a no-Library Core failure before create/open and keeps controls inaccessible until restart", async () => {
    await act(async () => harness.emit({ event: "core_needs_restart", value: { reason: "startup failed" } }));
    expect((button("New Library") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Open Library") as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(button("Restart Core"));
    await press("Enter");
    expect(harness.calls.restartCore).toBe(1);
    await focusAndPress(button("New Library"), "Enter");
    await waitFor(() => expect(text()).toContain("Film References"));
  });

  it("announces scalar-limit refusals without UTF-16 maxLength behavior", async () => {
    await focusAndPress(button("New Library"), "Enter");
    await waitFor(() => expect(host.querySelector('[data-asset-id="asset-1"]')).not.toBeNull());
    const search = input("Search");
    await replaceByKeyboard(search, "😀".repeat(201));
    await focusAndPress(search, "Enter");
    expect(text()).toContain("Search must be at most 200 Unicode characters.");
    await replaceByKeyboard(search, "😀".repeat(200));
    await focusAndPress(search, "Enter");
    await waitFor(() => expect(harness.lastQuery?.search).toBe("😀".repeat(200)));

    await focusAndPress(host.querySelector<HTMLElement>('[data-asset-id="asset-1"]')!, " ");
    await waitFor(() => expect(input("Title")).not.toBeNull());
    await replaceByKeyboard(input("Title"), "😀".repeat(501));
    expect(text()).toContain("Title must be at most 500 Unicode characters.");
    expect((button("Save", host.querySelector(".inspector")!) as HTMLButtonElement).disabled).toBe(true);
    await replaceByKeyboard(input("New Collection"), "e\u0301".repeat(101));
    expect(text()).toContain("Collection name must be at most 200 Unicode characters.");
  });

  it("adopts an already-completed external library_opened event instead of retaining a stale dirty session", async () => {
    await focusAndPress(button("New Library"), "Enter");
    await waitFor(() => expect(host.querySelector('[data-asset-id="asset-1"]')).not.toBeNull());
    await focusAndPress(host.querySelector<HTMLElement>('[data-asset-id="asset-1"]')!, " ");
    await waitFor(() => expect(input("Title")).not.toBeNull());
    await typeByKeyboard(input("Title"), " dirty");
    await act(async () => harness.emit({ event: "library_opened", value: { ...SESSION, sessionId: "session-external", libraryId: "library-external", name: "Externally Opened" } }));
    expect(text()).toContain("Externally Opened");
    expect(host.querySelector(".draft-mark")).toBeNull();
  });

  it("renames and confirms Collection deletion with Enter and Escape", async () => {
    await focusAndPress(button("New Library"), "Enter");
    await waitFor(() => expect(button("Rename Selects")).not.toBeNull());
    await focusAndPress(button("Rename Selects"), "Enter");
    const rename = input("Rename Selects");
    await replaceByKeyboard(rename, "Final Selects");
    await press("Enter");
    expect(harness.calls.renameCollection).toBe(1);
    await waitFor(() => expect(button("Delete Final Selects")).not.toBeNull());
    await focusAndPress(button("Delete Final Selects"), " ");
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(button("Delete Collection"));
    await press("Escape");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    await focusAndPress(button("Delete Final Selects"), "Enter");
    await focusAndPress(button("Delete Collection"), "Enter");
    expect(harness.calls.deleteCollection).toBe(1);
  });
});

class BridgeHarness {
  listeners = new Set<(event: WorkspaceEvent) => void>();
  roots: RootSummary[] = [{ rootId: "root-1", displayName: "Stills", rootKind: "linked", state: "needs_permission", authorized: false, activeJobId: null, observedCount: 2, unsupportedCount: 1 }];
  collections: CollectionSummary[] = [{ collectionId: "collection-1", name: "Selects", assetCount: 1, revision: 1 }];
  details = new Map(ASSETS.map((summary) => [summary.assetId, detail(summary)]));
  assets = [...ASSETS];
  authoritySession = SESSION;
  lastQuery: AssetQuery | null = null;
  calls = { openLibrary: 0, reauthorizeRoot: 0, scanRoot: 0, cancelJob: 0, updateAsset: 0, revealLocation: 0, renameCollection: 0, deleteCollection: 0, createCollection: 0, setCollectionMembership: 0, restartCore: 0, staleFollowUps: 0, updateSessions: [] as string[], writePreferences: [] as Array<Record<string, unknown>>, completeOpenIntent: [] as Array<[string, string]> };

  bridge: ReferenceWorkspaceBridge = {
    version: BRIDGE_VERSION,
    createLibrary: async () => { this.authoritySession = SESSION; return SESSION; },
    openLibrary: async () => { this.calls.openLibrary += 1; this.authoritySession = SESSION; return SESSION; },
    completeOpenIntent: async (intentId, decision) => { this.calls.completeOpenIntent.push([intentId, decision]); this.authoritySession = { ...SESSION, sessionId: "session-2", name: "Other Library" }; return this.authoritySession; },
    readPreferences: async () => ({ interfaceScale: 1, thumbnailDensity: 220, previewZoom: 1 }),
    writePreferences: async (patch) => { this.calls.writePreferences.push(patch); return { interfaceScale: 1, thumbnailDensity: 220, previewZoom: 1, ...patch }; },
    closeLibrary: async () => undefined,
    chooseRoot: async (sessionId) => {
      this.recordFollowUp(sessionId);
      this.authoritySession = { ...this.authoritySession, sessionId: "session-authority-1" };
      return { session: this.authoritySession, rootId: "root-added", jobId: "job-added" };
    },
    listRoots: async (sessionId) => { this.recordFollowUp(sessionId); return this.roots; },
    reauthorizeRoot: async (sessionId) => { this.recordFollowUp(sessionId); this.calls.reauthorizeRoot += 1; this.authoritySession = { ...this.authoritySession, sessionId: "session-authority-2" }; this.roots = this.roots.map((root) => ({ ...root, authorized: true, state: "ready" })); return { session: this.authoritySession, root: this.roots[0]! }; },
    scanRoot: async (_sessionId, rootId) => { this.calls.scanRoot += 1; this.roots = this.roots.map((root) => ({ ...root, activeJobId: "job-1", state: "scanning" })); return { rootId, jobId: "job-1" }; },
    cancelJob: async () => { this.calls.cancelJob += 1; this.roots = this.roots.map((root) => ({ ...root, activeJobId: null, state: "ready" })); },
    queryJobs: async () => ({ offset: 0, limit: 100, total: 0, items: [], nextOffset: null }),
    queryAssets: async (input): Promise<AssetPage> => { this.recordFollowUp(input.sessionId); this.lastQuery = input.query; const items = input.query.search === "no-match" ? [] : this.assets; return { offset: input.offset, limit: input.limit, total: items.length, items, nextOffset: null, libraryRevision: 1 }; },
    getAsset: async (sessionId, assetId) => { this.recordFollowUp(sessionId); return this.details.get(assetId)!; },
    updateAsset: async (input) => {
      this.calls.updateAsset += 1;
      this.calls.updateSessions.push(input.sessionId);
      this.recordFollowUp(input.sessionId);
      const current = this.details.get(input.assetId)!;
      const updated: AssetDetail = { ...current, customTitle: applyText(current.customTitle, input.patch.customTitle), note: applyText(current.note, input.patch.note), reviewState: input.patch.reviewState ?? current.reviewState, revision: current.revision + 1 };
      this.details.set(input.assetId, updated);
      return { asset: updated, libraryRevision: 2 };
    },
    listCollections: async (sessionId) => { this.recordFollowUp(sessionId); return this.collections; },
    createCollection: async (_sessionId, name) => { this.calls.createCollection += 1; const collection = { collectionId: `collection-${this.collections.length + 1}`, name, assetCount: 0, revision: 1 }; this.collections = [...this.collections, collection]; return collection; },
    renameCollection: async (_sessionId, id, _revision, name) => { this.calls.renameCollection += 1; this.collections = this.collections.map((item) => item.collectionId === id ? { ...item, name, revision: item.revision + 1 } : item); return this.collections[0]!; },
    deleteCollection: async (_sessionId, id) => { this.calls.deleteCollection += 1; this.collections = this.collections.filter((item) => item.collectionId !== id); },
    setCollectionMembership: async (input) => { this.calls.setCollectionMembership += 1; const current = this.details.get(input.assetIds[0]!)!; this.details.set(current.assetId, { ...current, collectionIds: input.member ? [...new Set([...current.collectionIds, input.collectionId])] : current.collectionIds.filter((id) => id !== input.collectionId) }); return { collectionId: input.collectionId, affected: input.assetIds.length, libraryRevision: 2 }; },
    assetResourceUrl: ({ assetId }) => `pitchdog-asset://opaque/${assetId}`,
    revealLocation: async () => { this.calls.revealLocation += 1; },
    queryCapabilities: async () => [],
    canonicalDump: async () => ({}),
    restartCore: async () => { this.calls.restartCore += 1; return null; },
    subscribe: (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); },
  };

  emit(event: WorkspaceEvent) { for (const listener of this.listeners) listener(event); }
  recordFollowUp(sessionId: string) { if (sessionId !== this.authoritySession.sessionId) this.calls.staleFollowUps += 1; }
}

function asset(assetId: string, displayName: string, availability: AssetSummary["availability"] = "present"): AssetSummary {
  return { assetId, locationId: `location-${assetId}`, displayName, relativeDisplayPath: `Stills/${displayName}`, mediaFamily: "still", availability, reviewState: "unreviewed", customTitle: null, revision: 1 };
}
function detail(summary: AssetSummary): AssetDetail { return { assetId: summary.assetId, locationId: summary.locationId, originalDisplayName: summary.displayName, relativeDisplayPath: summary.relativeDisplayPath, mediaFamily: summary.mediaFamily, availability: summary.availability, reviewState: summary.reviewState, customTitle: summary.customTitle, note: null, revision: summary.revision, collectionIds: [] }; }
function applyText(current: string | null, patch: { action: string; value?: string }): string | null { return patch.action === "clear" ? null : patch.action === "set" ? patch.value ?? null : current; }
function text() { return document.body.textContent ?? ""; }
function button(name: string, scope: ParentNode = hostNode()): HTMLElement { const found = [...scope.querySelectorAll<HTMLElement>("button")].find((element) => element.textContent?.trim() === name || element.getAttribute("aria-label") === name); if (!found) throw new Error(`button not found: ${name}`); return found; }
function input(name: string): HTMLInputElement { const found = [...document.querySelectorAll<HTMLInputElement>("input")].find((element) => element.getAttribute("aria-label") === name || element.closest("label")?.textContent?.includes(name)); if (!found) throw new Error(`input not found: ${name}`); return found; }
function select(name: string, scope: ParentNode = hostNode()): HTMLSelectElement { const found = [...scope.querySelectorAll<HTMLSelectElement>("select")].find((element) => element.closest("label")?.textContent?.includes(name)); if (!found) throw new Error(`select not found: ${name}`); return found; }
function hostNode(): ParentNode { return document.body; }
async function focusAndPress(element: HTMLElement, key: string) { element.focus(); await press(key); }
async function press(key: string, shiftKey = false) { await act(async () => { const target = document.activeElement as HTMLElement; const down = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }); target.dispatchEvent(down); if (!down.defaultPrevented) { if ((key === "Enter" || key === " ") && target instanceof HTMLButtonElement) target.click(); else if (key === " " && target instanceof HTMLInputElement && target.type === "checkbox") target.click(); else if (key === "Enter" && target instanceof HTMLInputElement) target.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); else if (key === "Tab") moveTab(target, shiftKey); } target.dispatchEvent(new KeyboardEvent("keyup", { key, shiftKey, bubbles: true })); await settle(); }); }
function moveTab(current: HTMLElement, reverse: boolean) { const controls = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]; const index = controls.indexOf(current); controls[(index + (reverse ? -1 : 1) + controls.length) % controls.length]?.focus(); }
async function typeByKeyboard(element: HTMLInputElement, value: string) { element.focus(); for (const character of value) await act(async () => { setNativeValue(element, element.value + character); element.dispatchEvent(new InputEvent("input", { data: character, inputType: "insertText", bubbles: true })); await settle(); }); }
async function replaceByKeyboard(element: HTMLInputElement, value: string) { await act(async () => { element.focus(); setNativeValue(element, value); element.dispatchEvent(new InputEvent("input", { data: value, inputType: "insertText", bubbles: true })); await settle(); }); }
async function selectByKeyboard(element: HTMLSelectElement, value: string) { await act(async () => { element.focus(); element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); setNativeValue(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); element.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown", bubbles: true })); await settle(); }); }
async function changeInputByKeyboard(element: HTMLInputElement, value: string, key: string) { await act(async () => { element.focus(); element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); setNativeValue(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true })); await settle(); }); }
function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) { const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value); }
async function waitFor(assertion: () => void) { for (let index = 0; index < 30; index += 1) { try { assertion(); return; } catch (error) { if (index === 29) throw error; await act(settle); } } }
async function settle() { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); }
