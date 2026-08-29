import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BRIDGE_VERSION,
  DEFAULT_ASSET_QUERY,
  type AssetDetail,
  type AssetQuery,
  type AssetSummary,
  type AssetViewMode,
  type CollectionSummary,
  type InterfaceScale,
  type ReferenceWorkspaceBridge,
  type ReviewState,
  type SessionOpened,
  type RootSummary,
  type WorkspaceEvent,
  type WorkspacePreferences,
} from "@pitchdog/reference-bridge";
import { AssetInspector } from "./asset-inspector";
import { AssetPreview } from "./asset-preview";
import { CompareBoard } from "./compare-board";
import { ContactSheet } from "./contact-sheet";
import { LibrarySidebar } from "./library-sidebar";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { QueryToolbar } from "./query-toolbar";
import { SelectionTray } from "./selection-tray";
import { ProductMark } from "./product-mark";
import {
  addShortlistRange,
  compareAssets,
  mergeAssetDetail,
  moveShortlistedAsset,
  refreshSelectedAsset,
  refreshShortlistedAssets,
  replaceShortlistedAsset,
  toggleShortlistedAsset,
  type ShortlistMove,
} from "./selection";
import { assetDraftErrors, useAssetEditor } from "./use-asset-editor";
import { batchOutcomeMessage, parseBatchTokens, runBatchCuration, type BatchCurationAction } from "./batch-curation";
import { useAssetPager } from "./use-asset-pager";
import { handleDialogKey } from "./dialog-keys";
import { safeErrorMessage } from "./safe-errors";
import { useModalIsolation } from "./modal-isolation";
import {
  WorkspaceEventInvalidator,
  applyInvalidationBatch,
  initialWorkspaceInvalidations,
  type WorkspaceInvalidations,
} from "./workspace-events";

const INTERFACE_SCALES: InterfaceScale[] = [0.8, 1, 1.25, 1.5];

export function App() {
  const bridge = window.referenceLibrary;
  if (!bridge || bridge.version !== BRIDGE_VERSION) {
    return <FatalState message="Native Reference Library bridge is unavailable or incompatible." />;
  }
  return <LibraryWorkspace bridge={bridge} />;
}

function LibraryWorkspace({ bridge }: { bridge: ReferenceWorkspaceBridge }) {
  const [session, setSession] = useState<SessionOpened | null>(null);
  const [invalidations, setInvalidations] = useState(initialWorkspaceInvalidations);
  const [busy, setBusy] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [openIntent, setOpenIntent] = useState<{ intentId: string; displayName: string } | null>(null);

  useEffect(() => {
    const invalidator = new WorkspaceEventInvalidator((batch) => {
      setInvalidations((current) => applyInvalidationBatch(current, batch));
    });
    const unsubscribe = bridge.subscribe((event: WorkspaceEvent) => {
      if (event.event === "library_opened") {
        invalidator.reset();
        setInvalidations(initialWorkspaceInvalidations());
        setSession(event.value);
        setOpenIntent(null);
        setNeedsRestart(false);
        setShellError(null);
      } else if (event.event === "library_open_requested") {
        setOpenIntent(event.value);
      } else if (event.event === "library_closed") {
        invalidator.reset();
        setInvalidations(initialWorkspaceInvalidations());
        setSession((current) => current?.sessionId === event.value.sessionId ? null : current);
      } else if (event.event === "core_needs_restart") {
        setShellError("Reference Core stopped. Restart it to continue.");
        setNeedsRestart(true);
      } else {
        invalidator.accept(event);
      }
    });
    return () => {
      unsubscribe();
      invalidator.dispose();
    };
  }, [bridge]);

  const openSession = async (mode: "create" | "open") => {
    setBusy(true);
    setShellError(null);
    try {
      const opened = mode === "create" ? await bridge.createLibrary("Project Reference Library") : await bridge.openLibrary();
      if (opened) setSession(opened);
    } catch (reason) { setShellError(messageFrom(reason)); }
    finally { setBusy(false); }
  };

  const restart = async () => {
    setBusy(true);
    try {
      const reopened = await bridge.restartCore();
      setSession(reopened);
      setNeedsRestart(false);
      setShellError(null);
    } catch (reason) { setShellError(messageFrom(reason)); }
    finally { setBusy(false); }
  };

  const resolveCleanIntent = async (decision: "discard" | "cancel") => {
    if (!openIntent) return;
    setBusy(true);
    try {
      const opened = await bridge.completeOpenIntent(openIntent.intentId, decision);
      setOpenIntent(null);
      if (opened) setSession(opened);
    } catch (reason) { setShellError(messageFrom(reason)); }
    finally { setBusy(false); }
  };

  if (!session) {
    return (
      <main className="document-empty">
        <section className="document-empty__card" aria-busy={busy} inert={Boolean(openIntent)} aria-hidden={Boolean(openIntent)}>
          <div className="document-empty__mark"><ProductMark variant="hero" /></div>
          <div className="document-empty__content">
          <p className="eyebrow">Reference Library</p><h1>Your project’s visual memory.</h1>
          <p className="document-empty__lede">Gather widely. Compare closely. Keep the decisions that make the deck yours.</p>
          <ul className="document-empty__principles" aria-label="Product principles">
            <li>Originals stay where they are</li><li>No account or cloud</li><li>No AI deciding what matters</li>
          </ul>
          <div className="button-row">
            <button disabled={busy || needsRestart} onClick={() => void openSession("create")}>New Library</button>
            <button className="button--secondary" disabled={busy || needsRestart} onClick={() => void openSession("open")}>Open Library</button>
            {needsRestart && <button autoFocus onClick={() => void restart()}>Restart Core</button>}
          </div>
          {busy && <p role="status">Waiting for destination…</p>}
          {shellError && <p className="error-state" role="alert">{shellError}</p>}
          </div>
        </section>
        {openIntent && <SimpleIntentDialog displayName={openIntent.displayName} onOpen={() => void resolveCleanIntent("discard")} onCancel={() => void resolveCleanIntent("cancel")} />}
      </main>
    );
  }

  return (
    <OpenWorkspace
      key={session.libraryId}
      bridge={bridge}
      session={session}
      invalidations={invalidations}
      openIntent={openIntent}
      needsRestart={needsRestart}
      shellError={shellError}
      setShellError={setShellError}
      onSession={setSession}
      onRestarted={() => setNeedsRestart(false)}
      onIntentComplete={() => setOpenIntent(null)}
    />
  );
}

interface PendingTransition {
  label: string;
  dirty: boolean;
  proceed(choice: "save" | "discard"): Promise<void> | void;
  cancel?(): Promise<void> | void;
  focus: HTMLElement | null;
}

function OpenWorkspace(props: {
  bridge: ReferenceWorkspaceBridge;
  session: SessionOpened;
  invalidations: WorkspaceInvalidations;
  openIntent: { intentId: string; displayName: string } | null;
  needsRestart: boolean;
  shellError: string | null;
  setShellError(value: string | null): void;
  onSession(value: SessionOpened | null): void;
  onRestarted(): void;
  onIntentComplete(): void;
}) {
  const [interfaceScale, setInterfaceScale] = useState<InterfaceScale>(1);
  const [thumbnailSize, setThumbnailSize] = useState(220);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [viewMode, setViewMode] = useState<AssetViewMode>("grid");
  const [multiThumbnailPreviews, setMultiThumbnailPreviews] = useState(false);
  const [autoRescan, setAutoRescan] = useState(false);
  const [query, setQuery] = useState<AssetQuery>({ ...DEFAULT_ASSET_QUERY });
  const [selected, setSelected] = useState<AssetSummary | null>(null);
  const [shortlisted, setShortlisted] = useState<AssetSummary[]>([]);
  const [shortlistAnchorIndex, setShortlistAnchorIndex] = useState<number | null>(null);
  const [shortlistStatus, setShortlistStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<AssetSummary | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [roots, setRoots] = useState<RootSummary[]>([]);
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [sidebarModalOpen, setSidebarModalOpen] = useState(false);
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  useModalIsolation(workspace, Boolean(preview || compareOpen || pending || sidebarModalOpen || shortcutsOpen));
  const pager = useAssetPager(
    props.bridge,
    props.session.sessionId,
    query,
    props.invalidations.assets,
    multiThumbnailPreviews ? "contact_sheet_detailed" : "contact_sheet_standard",
  );
  const refreshSummary = pager.refreshSummary;
  const applyAssetDetail = useCallback((detail: AssetDetail) => {
    refreshSummary(detail);
    setSelected((current) => current ? mergeAssetDetail(current, detail) : current);
    setPreview((current) => current ? mergeAssetDetail(current, detail) : current);
    setShortlisted((current) => replaceShortlistedAsset(current, detail));
  }, [refreshSummary]);
  const editor = useAssetEditor(
    props.bridge,
    props.session.sessionId,
    selected,
    props.invalidations.detail,
    applyAssetDetail,
  );
  const shortlistedIds = useMemo(() => new Set(shortlisted.map((asset) => asset.assetId)), [shortlisted]);
  const comparedAssets = useMemo(() => compareAssets(shortlisted), [shortlisted]);

  useEffect(() => {
    let active = true;
    void props.bridge.readPreferences().then((preferences) => {
      if (!active) return;
      setInterfaceScale(preferences.interfaceScale);
      setThumbnailSize(preferences.thumbnailDensity);
      setPreviewZoom(preferences.previewZoom);
      setViewMode(preferences.viewMode);
      setMultiThumbnailPreviews(preferences.multiThumbnailPreviews);
      setAutoRescan(preferences.autoRescan);
    }).catch((reason) => {
      if (active) props.setShellError(messageFrom(reason));
    });
    return () => { active = false; };
  }, [props.bridge]);

  const writePreferences = (patch: Partial<WorkspacePreferences>) => {
    void props.bridge.writePreferences(patch).catch((reason) => props.setShellError(messageFrom(reason)));
  };

  useEffect(() => document.documentElement.style.setProperty("--ui-scale", String(interfaceScale)), [interfaceScale]);
  useEffect(() => {
    const refreshed = refreshSelectedAsset(selected, pager.items.values());
    if (refreshed !== selected) setSelected(refreshed);
    const refreshedPreview = refreshSelectedAsset(preview, pager.items.values());
    if (refreshedPreview !== preview) setPreview(refreshedPreview);
    setShortlisted((current) => refreshShortlistedAssets(current, pager.items.values()));
  }, [pager.items, preview, selected]);

  useEffect(() => {
    if (compareOpen && comparedAssets.length < 2) setCompareOpen(false);
  }, [compareOpen, comparedAssets.length]);

  useEffect(() => {
    if (!selected) setInspectorDrawerOpen(false);
  }, [selected]);

  useEffect(() => {
    if (!libraryDrawerOpen && !inspectorDrawerOpen) return;
    const closeDrawer = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (inspectorDrawerOpen) setInspectorDrawerOpen(false);
      else setLibraryDrawerOpen(false);
    };
    window.addEventListener("keydown", closeDrawer);
    return () => window.removeEventListener("keydown", closeDrawer);
  }, [inspectorDrawerOpen, libraryDrawerOpen]);

  useEffect(() => {
    if (!autoRescan || props.needsRestart || roots.length === 0) return;
    let cursor = 0;
    const tick = () => {
      const candidates = roots.filter((root) => root.authorized && !root.activeJobId && root.state !== "scanning");
      if (candidates.length === 0) return;
      const root = candidates[cursor % candidates.length]!;
      cursor += 1;
      void props.bridge.scanRoot(props.session.sessionId, root.rootId).catch((reason) => props.setShellError(messageFrom(reason)));
    };
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [autoRescan, props.bridge, props.needsRestart, props.session.sessionId, roots]);

  const requestTransition = useCallback((label: string, proceed: PendingTransition["proceed"], cancel?: PendingTransition["cancel"]) => {
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!editor.dirty) {
      void Promise.resolve(proceed("discard"));
      return;
    }
    setPending({ label, dirty: true, proceed, cancel, focus });
  }, [editor.dirty]);

  const resolveTransition = async (choice: "save" | "discard" | "cancel") => {
    const transition = pending;
    if (!transition) return;
    if (choice === "cancel") {
      setPending(null);
      await transition.cancel?.();
      requestAnimationFrame(() => transition.focus?.isConnected && transition.focus.focus());
      return;
    }
    if (choice === "save" && !(await editor.save())) return;
    if (choice === "discard") editor.discard();
    setPending(null);
    await transition.proceed(choice);
  };

  useEffect(() => {
    if (!props.openIntent || pending) return;
    const intent = props.openIntent;
    const proceed = async (choice: "save" | "discard") => {
      setBusy(true);
      props.onIntentComplete();
      try {
        const opened = await props.bridge.completeOpenIntent(intent.intentId, choice);
        if (opened) props.onSession(opened);
      } catch (reason) { props.setShellError(messageFrom(reason)); }
      finally { setBusy(false); }
    };
    const cancel = async () => {
      props.onIntentComplete();
      try { await props.bridge.completeOpenIntent(intent.intentId, "cancel"); }
      catch (reason) { props.setShellError(messageFrom(reason)); }
    };
    if (editor.dirty) requestTransition(`Open “${intent.displayName}”`, proceed, cancel);
    else setPending({ label: `Open “${intent.displayName}”`, dirty: false, proceed, cancel, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  }, [props.openIntent, pending, requestTransition]);

  const toggleShortlist = (asset: AssetSummary, index: number, extendRange: boolean) => {
    if (batchBusy) {
      setShortlistStatus("Finish the current batch update before changing the shortlist.");
      return;
    }
    const mutation = extendRange && shortlistAnchorIndex !== null
      ? addShortlistRange(shortlisted, pager.items, shortlistAnchorIndex, index)
      : toggleShortlistedAsset(shortlisted, asset);
    setShortlisted(mutation.assets);
    setShortlistAnchorIndex(index);
    setShortlistStatus(mutation.capped ? "Shortlist limit reached: 32 Assets." : null);
  };

  const requestCompare = (asset?: AssetSummary, index?: number) => {
    if (batchBusy) {
      setShortlistStatus("Finish the current batch update before comparing.");
      return;
    }
    requestTransition("Open the Compare Board", () => {
      let next = shortlisted;
      if (asset && !shortlistedIds.has(asset.assetId)) {
        const mutation = toggleShortlistedAsset(shortlisted, asset);
        next = mutation.assets;
        setShortlisted(next);
        if (index !== undefined) setShortlistAnchorIndex(index);
        if (mutation.capped) setShortlistStatus("Shortlist limit reached: 32 Assets.");
      }
      if (next.length < 2) {
        setShortlistStatus("Shortlist one more Asset to compare.");
        return;
      }
      setPreview(null);
      setLibraryDrawerOpen(false);
      setInspectorDrawerOpen(false);
      setCompareOpen(true);
    });
  };

  const updateReview = async (asset: AssetSummary, reviewState: ReviewState): Promise<boolean> => {
    setBatchBusy(true);
    try {
      const freshDetail = await props.bridge.getAsset(props.session.sessionId, asset.assetId);
      const freshAsset = mergeAssetDetail(asset, freshDetail);
      if (freshAsset.reviewState === reviewState) {
        applyAssetDetail(freshDetail);
        setShortlistStatus(`${freshDetail.customTitle ?? freshDetail.originalDisplayName} already marked ${reviewState}.`);
        return true;
      }
      const result = await props.bridge.updateAsset({
        sessionId: props.session.sessionId,
        assetId: freshAsset.assetId,
        expectedRevision: freshAsset.revision,
        patch: {
          customTitle: { action: "unchanged" },
          reviewState,
          note: { action: "unchanged" },
          tags: { action: "unchanged" },
          usedIn: { action: "unchanged" },
        },
      });
      applyAssetDetail(result.asset);
      setShortlistStatus(`${result.asset.customTitle ?? result.asset.originalDisplayName} marked ${reviewState}.`);
      return true;
    } catch (reason) {
      pager.refresh();
      props.setShellError(messageFrom(reason));
      return false;
    } finally {
      setBatchBusy(false);
    }
  };

  const requestReview = (asset: AssetSummary, reviewState: ReviewState) => {
    if (batchBusy) return;
    requestTransition(
      `Mark ${asset.displayName} ${reviewState}`,
      async () => { await updateReview(asset, reviewState); },
    );
  };

  const performBatch = async (action: BatchCurationAction) => {
    setBatchBusy(true);
    try {
      const outcome = await runBatchCuration(
        shortlisted,
        action,
        async (asset, patch) => {
          const result = await props.bridge.updateAsset({
            sessionId: props.session.sessionId,
            assetId: asset.assetId,
            expectedRevision: asset.revision,
            patch,
          });
          applyAssetDetail(result.asset);
          return result.asset;
        },
        async (asset) => mergeAssetDetail(
          asset,
          await props.bridge.getAsset(props.session.sessionId, asset.assetId),
        ),
      );
      setShortlistStatus(batchOutcomeMessage(outcome));
      if (outcome.failed.length) {
        pager.refresh();
        props.setShellError(`${outcome.failed.length} shortlisted Assets changed elsewhere or could not be updated. The Library has been refreshed.`);
      }
    } finally {
      setBatchBusy(false);
    }
  };

  const requestBatch = (
    label: string,
    action: BatchCurationAction,
    onAccepted?: () => void,
  ) => {
    if (batchBusy || shortlisted.length === 0) return;
    requestTransition(label, () => {
      onAccepted?.();
      return performBatch(action);
    });
  };

  const addBatchTokens = (
    kind: "tags" | "usedIn",
    value: string,
    onAccepted: () => void,
  ): boolean => {
    const tokens = parseBatchTokens(value);
    if (tokens.length === 0) {
      setShortlistStatus(`Enter at least one ${kind === "tags" ? "tag" : "Used In value"}.`);
      return false;
    }
    requestBatch(
      `Update ${shortlisted.length} shortlisted Assets`,
      kind === "tags" ? { addTags: tokens } : { addUsedIn: tokens },
      onAccepted,
    );
    return true;
  };

  const addShortlistToCollection = (collectionId: string, onAccepted: () => void) => {
    if (batchBusy || shortlisted.length === 0) return;
    requestTransition(
      `Add ${shortlisted.length} Assets to a Collection`,
      async () => {
        onAccepted();
        setBatchBusy(true);
        try {
          const result = await props.bridge.setCollectionMembership({
            sessionId: props.session.sessionId,
            collectionId,
            assetIds: shortlisted.map((asset) => asset.assetId),
            member: true,
          });
          setShortlistStatus(`Added ${result.affected} Assets to the Collection.`);
          pager.refresh();
        } catch (reason) {
          props.setShellError(messageFrom(reason));
        } finally {
          setBatchBusy(false);
        }
      },
    );
  };

  const moveShortlist = (assetId: string, direction: ShortlistMove) => {
    if (batchBusy) return;
    const next = moveShortlistedAsset(shortlisted, assetId, direction);
    if (next === shortlisted) return;
    setShortlisted(next);
    const asset = next.find((candidate) => candidate.assetId === assetId);
    const position = next.findIndex((candidate) => candidate.assetId === assetId) + 1;
    setShortlistStatus(`${asset?.displayName ?? "Asset"} moved to ${position <= 4 ? `Compare slot ${position}` : `queue position ${position}`}.`);
  };

  const removeFromShortlist = (assetId: string) => {
    if (batchBusy) return;
    const next = shortlisted.filter((asset) => asset.assetId !== assetId);
    setShortlisted(next);
    setShortlistStatus(null);
    if (compareOpen && compareAssets(next).length < 2) setCompareOpen(false);
  };

  const clearShortlist = () => {
    if (batchBusy) return;
    setShortlisted([]);
    setShortlistAnchorIndex(null);
    setShortlistStatus(null);
    setCompareOpen(false);
  };

  const applyQuery = (next: AssetQuery) => requestTransition("Change the Asset view", () => { setQuery(next); setPreview(null); });
  const chooseAsset = (asset: AssetSummary) => {
    if (asset.assetId === selected?.assetId) return;
    requestTransition(`Select ${asset.displayName}`, () => {
      setSelected(asset);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-asset-id="${asset.assetId}"]`)?.focus({ preventScroll: true }));
    });
  };
  const closeLibrary = () => requestTransition("Close this Library", async () => {
    setBusy(true);
    try { await props.bridge.closeLibrary(props.session.sessionId); props.onSession(null); }
    catch (reason) { props.setShellError(messageFrom(reason)); }
    finally { setBusy(false); }
  });
  const restartCore = () => requestTransition("Restart Reference Core", async () => {
    setBusy(true);
    try { const opened = await props.bridge.restartCore(); props.onSession(opened); props.onRestarted(); props.setShellError(null); }
    catch (reason) { props.setShellError(messageFrom(reason)); }
    finally { setBusy(false); }
  });
  const addRoot = async () => {
    setBusy(true);
    try {
      const result = await props.bridge.chooseRoot(props.session.sessionId);
      if (result) props.onSession(result.session);
    } catch (reason) { props.setShellError(messageFrom(reason)); }
    finally { setBusy(false); }
  };
  const clearAssetView = () => applyQuery({ ...DEFAULT_ASSET_QUERY });
  const openPreview = (asset: AssetSummary) => {
    setLibraryDrawerOpen(false);
    setInspectorDrawerOpen(false);
    setPreview(asset);
  };
  const closeInspector = () => setInspectorDrawerOpen(false);

  return (
    <main ref={workspace} className="workspace-shell">
      <header className="topbar">
        <div className="topbar__identity">
          <ProductMark variant="compact" />
          <div className="topbar__title"><p className="eyebrow">Reference Library</p><h1>{props.session.name}</h1></div>
        </div>
        <div className="topbar__status" aria-label="Current Library summary">
          <strong>{pager.total.toLocaleString()}</strong><span>{pager.total === 1 ? "Asset" : "Assets"}</span>
        </div>
        <div className="topbar__actions">
          <button
            className="button--quiet topbar__drawer-toggle topbar__library-toggle"
            aria-controls="library-navigation"
            aria-expanded={libraryDrawerOpen}
            onClick={() => { setInspectorDrawerOpen(false); setLibraryDrawerOpen((open) => !open); }}
          >Library</button>
          <button
            className="button--quiet topbar__drawer-toggle topbar__inspector-toggle"
            aria-controls="asset-inspector"
            aria-expanded={inspectorDrawerOpen}
            disabled={!selected}
            onClick={() => { setLibraryDrawerOpen(false); setInspectorDrawerOpen((open) => !open); }}
          >Inspector</button>
          <button className="button--quiet topbar__shortcuts" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}>Shortcuts</button>
          <details className="workspace-menu">
            <summary>View & Library</summary>
            <div className="workspace-menu__panel">
              <label>Interface<select value={interfaceScale} onChange={(event) => { const value = Number(event.target.value) as InterfaceScale; setInterfaceScale(value); writePreferences({ interfaceScale: value }); }}>{INTERFACE_SCALES.map((scale) => <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>)}</select></label>
              <label>Thumbnail size<input aria-label="Thumbnail size" max="340" min="140" step="20" type="range" value={thumbnailSize} onChange={(event) => { const value = Number(event.target.value); setThumbnailSize(value); writePreferences({ thumbnailDensity: value }); }} /></label>
              <div className="view-switcher" role="group" aria-label="Asset view">
                {(["grid", "compact", "list"] as AssetViewMode[]).map((mode) => (
                  <button className="button--secondary" aria-pressed={viewMode === mode} key={mode} onClick={() => { setViewMode(mode); writePreferences({ viewMode: mode }); }}>{mode}</button>
                ))}
              </div>
              <label className="toggle-control"><input type="checkbox" checked={multiThumbnailPreviews} onChange={(event) => { setMultiThumbnailPreviews(event.target.checked); writePreferences({ multiThumbnailPreviews: event.target.checked }); }} /><span>Multiple thumbnails</span></label>
              <label className="toggle-control"><input type="checkbox" checked={autoRescan} onChange={(event) => { setAutoRescan(event.target.checked); writePreferences({ autoRescan: event.target.checked }); }} /><span>Auto-rescan · 60 s</span></label>
              <button className="button--secondary workspace-menu__close" disabled={busy} onClick={closeLibrary}>Close Library</button>
            </div>
          </details>
        </div>
        <QueryToolbar query={query} roots={roots} facets={pager.facets} disabled={busy || props.needsRestart} onChange={applyQuery} />
      </header>
      {(libraryDrawerOpen || inspectorDrawerOpen) && (
        <button
          className="workspace-drawer-backdrop"
          aria-label="Close open panel"
          onClick={() => { setLibraryDrawerOpen(false); setInspectorDrawerOpen(false); }}
        />
      )}
      <LibrarySidebar
        bridge={props.bridge}
        sessionId={props.session.sessionId}
        total={pager.total}
        drawerOpen={libraryDrawerOpen}
        selectedCollectionId={query.collectionId}
        rootRevision={props.invalidations.roots}
        collectionRevision={props.invalidations.collections}
        disabled={busy || props.needsRestart}
        onCollectionChange={(collectionId) => { applyQuery({ ...query, collectionId }); setLibraryDrawerOpen(false); }}
        onClose={() => setLibraryDrawerOpen(false)}
        onDeleteActiveCollection={(label, action) => requestTransition(label, async () => {
          await action();
          setQuery((current) => ({ ...current, collectionId: null }));
          setPreview(null);
        })}
        onError={props.setShellError}
        onCollectionInventory={setCollections}
        onRootInventory={setRoots}
        onSession={props.onSession}
        onModalChange={setSidebarModalOpen}
      />
      <section className={`workspace-main${shortlisted.length ? " workspace-main--shortlist-open" : ""}`} aria-label="Assets">
        {props.shellError && <div className="error-banner" role="alert"><span>{props.shellError}</span><div className="compact-actions">{props.needsRestart ? <button onClick={restartCore}>Restart Core</button> : <button className="button--quiet" onClick={() => props.setShellError(null)}>Dismiss</button>}</div></div>}
        {pager.error ? <WorkspaceState kind="error" title="Library query failed" detail={pager.error} action="Retry" onAction={pager.refresh} />
          : pager.loading && pager.total === 0 ? <WorkspaceState kind="status" title="Opening contact sheet" detail="Reading the first bounded Asset window…" />
          : pager.total === 0 ? <WorkspaceState
              title={hasActiveQuery(query) ? "No Assets match this view" : "This Library has no Assets yet"}
              detail={hasActiveQuery(query) ? "Clear the current view, or rescan an authorized Root." : "Connect a folder of project material. Assets appear progressively while the scan continues."}
              action={hasActiveQuery(query) ? "Clear Filters" : "Add Root"}
              onAction={hasActiveQuery(query) ? clearAssetView : () => void addRoot()}
            />
          : <ContactSheet
              bridge={props.bridge}
              sessionId={props.session.sessionId}
              total={pager.total}
              items={pager.items}
              thumbnailSize={thumbnailSize}
              viewMode={viewMode}
              multiThumbnailPreviews={multiThumbnailPreviews}
              selectedAssetId={selected?.assetId ?? null}
              shortlistedAssetIds={shortlistedIds}
              ensureWindow={pager.ensureWindow}
              onSelect={chooseAsset}
              onToggleShortlist={toggleShortlist}
              onRequestCompare={requestCompare}
              onReview={requestReview}
              onPreview={openPreview}
              onOpen={(asset) => void props.bridge.openLocation(props.session.sessionId, asset.locationId).catch((reason) => props.setShellError(messageFrom(reason)))}
            />}
        {shortlisted.length > 0 && <SelectionTray
          bridge={props.bridge}
          sessionId={props.session.sessionId}
          assets={shortlisted}
          collections={collections}
          busy={batchBusy}
          status={shortlistStatus}
          onInspect={chooseAsset}
          onRemove={removeFromShortlist}
          onMove={moveShortlist}
          onClear={clearShortlist}
          onCompare={() => requestCompare()}
          onReview={(reviewState) => requestBatch(`Mark ${shortlisted.length} shortlisted Assets ${reviewState}`, { reviewState })}
          onAddTags={(value, onAccepted) => addBatchTokens("tags", value, onAccepted)}
          onAddUsedIn={(value, onAccepted) => addBatchTokens("usedIn", value, onAccepted)}
          onAddCollection={addShortlistToCollection}
        />}
      </section>
      <AssetInspector
        bridge={props.bridge}
        sessionId={props.session.sessionId}
        detail={editor.detail}
        draft={editor.draft}
        drawerOpen={inspectorDrawerOpen}
        collections={collections}
        loading={editor.loading}
        saving={editor.saving}
        dirty={editor.dirty}
        error={editor.error}
        onDraft={editor.setDraft}
        onSave={editor.save}
        onDiscard={editor.discard}
        onReload={editor.reload}
        onPreview={(detail) => openPreview(summaryFromDetail(detail))}
        onClose={closeInspector}
        onError={props.setShellError}
      />
      <div className="selection-announcer" aria-live="polite">{selected ? `Selected ${selected.displayName}. ${shortlisted.length} Assets shortlisted.` : `${shortlisted.length} Assets shortlisted.`}</div>
      {preview && <AssetPreview
        asset={preview}
        source={props.bridge.assetResourceUrl({ sessionId: props.session.sessionId, assetId: preview.assetId, profile: "preview" })}
        bridge={props.bridge}
        sessionId={props.session.sessionId}
        initialZoom={previewZoom}
        onZoomChange={(value) => { setPreviewZoom(value); writePreferences({ previewZoom: value }); }}
        onError={props.setShellError}
        onClose={() => { const assetId = preview.assetId; setPreview(null); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-asset-id="${assetId}"]`)?.focus()); }}
      />}
      {compareOpen && comparedAssets.length >= 2 && <CompareBoard
        bridge={props.bridge}
        sessionId={props.session.sessionId}
        assets={comparedAssets}
        totalShortlisted={shortlisted.length}
        onReview={updateReview}
        onRemove={removeFromShortlist}
        onError={props.setShellError}
        onClose={() => { setCompareOpen(false); requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-compare-trigger]")?.focus()); }}
      />}
      {pending && <TransitionDialog label={pending.label} dirty={pending.dirty} canSave={assetDraftErrors(editor.draft).length === 0} onChoice={(choice) => void resolveTransition(choice)} />}
      {shortcutsOpen && <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </main>
  );
}

function TransitionDialog(props: { label: string; dirty: boolean; canSave: boolean; onChoice(choice: "save" | "discard" | "cancel"): void }) {
  return <div className="confirmation" role="alertdialog" aria-modal="true" aria-labelledby="transition-title" onKeyDown={(event) => handleDialogKey(event, () => props.onChoice("cancel"))}>
    <h2 id="transition-title">{props.dirty ? "Save Asset edits?" : props.label}</h2><p>{props.dirty ? `${props.label} would leave the current draft.` : "Reference Library received this native open request."}</p>
    <div className="button-row">{props.dirty && <button disabled={!props.canSave} onClick={() => props.onChoice("save")}>Save and Continue</button>}<button className={props.dirty ? "button--secondary" : undefined} onClick={() => props.onChoice("discard")}>{props.dirty ? "Discard and Continue" : "Open"}</button><button autoFocus className="button--secondary" onClick={() => props.onChoice("cancel")}>Cancel</button></div>
  </div>;
}

function SimpleIntentDialog(props: { displayName: string; onOpen(): void; onCancel(): void }) {
  return <div className="confirmation" role="alertdialog" aria-modal="true" aria-labelledby="intent-title" onKeyDown={(event) => handleDialogKey(event, props.onCancel)}><h2 id="intent-title">Open another Library?</h2><p>Open “{props.displayName}”?</p><div className="button-row"><button onClick={props.onOpen}>Open</button><button autoFocus className="button--secondary" onClick={props.onCancel}>Cancel</button></div></div>;
}

function WorkspaceState(props: { title: string; detail: string; kind?: "status" | "error"; action?: string; onAction?(): void }) {
  return <div className="workspace-state" role={props.kind === "error" ? "alert" : props.kind} aria-live={props.kind === "status" ? "polite" : undefined}><h2>{props.title}</h2><p>{props.detail}</p>{props.action && <button onClick={props.onAction}>{props.action}</button>}</div>;
}

function FatalState({ message }: { message: string }) {
  return <main className="document-empty"><p className="error-state" role="alert">{message}</p></main>;
}

function hasActiveQuery(query: AssetQuery): boolean {
  return Boolean(query.search || query.rootId || query.collectionId || query.reviewStates.length ||
    query.availability.length || query.categories.length || query.extensions.length ||
    query.mediaFamilies.length || query.tags.length || query.usedIn.length);
}

function summaryFromDetail(detail: AssetDetail): AssetSummary {
  return {
    assetId: detail.assetId,
    locationId: detail.locationId,
    displayName: detail.customTitle ?? detail.originalDisplayName,
    relativeDisplayPath: detail.relativeDisplayPath,
    mediaFamily: detail.mediaFamily,
    mimeType: detail.mimeType,
    extension: detail.extension,
    byteSize: detail.byteSize,
    category: detail.category,
    previewKind: detail.previewKind,
    availability: detail.availability,
    reviewState: detail.reviewState,
    customTitle: detail.customTitle,
    tags: detail.tags,
    usedIn: detail.usedIn,
    previewAssetIds: [],
    createdAtMs: 0,
    revision: detail.revision,
  };
}

function messageFrom(reason: unknown): string {
  return safeErrorMessage(reason, "Reference Library operation failed.");
}
