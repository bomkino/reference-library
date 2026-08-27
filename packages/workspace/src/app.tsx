import { useCallback, useEffect, useState } from "react";
import {
  BRIDGE_VERSION,
  DEFAULT_ASSET_QUERY,
  type AssetQuery,
  type AssetSummary,
  type CollectionSummary,
  type InterfaceScale,
  type ReferenceWorkspaceBridge,
  type SessionOpened,
  type RootSummary,
  type WorkspaceEvent,
  type WorkspacePreferences,
} from "@pitchdog/reference-bridge";
import { AssetInspector } from "./asset-inspector";
import { AssetPreview } from "./asset-preview";
import { ContactSheet } from "./contact-sheet";
import { LibrarySidebar } from "./library-sidebar";
import { QueryToolbar } from "./query-toolbar";
import { refreshSelectedAsset } from "./selection";
import { assetDraftErrors, useAssetEditor } from "./use-asset-editor";
import { useAssetPager } from "./use-asset-pager";
import { handleDialogKey } from "./dialog-keys";
import { safeErrorMessage } from "./safe-errors";
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
        <section className="document-empty__card" aria-busy={busy}>
          <p className="eyebrow">Reference Library</p><h1>Your project’s visual memory.</h1><p>Local. Manual. One Library per project.</p>
          <div className="button-row">
            <button disabled={busy || needsRestart} onClick={() => void openSession("create")}>New Library</button>
            <button className="button--secondary" disabled={busy || needsRestart} onClick={() => void openSession("open")}>Open Library</button>
            {needsRestart && <button autoFocus onClick={() => void restart()}>Restart Core</button>}
          </div>
          {busy && <p role="status">Waiting for destination…</p>}
          {shellError && <p className="error-state" role="alert">{shellError}</p>}
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
  const [query, setQuery] = useState<AssetQuery>({ ...DEFAULT_ASSET_QUERY });
  const [selected, setSelected] = useState<AssetSummary | null>(null);
  const [preview, setPreview] = useState<AssetSummary | null>(null);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [roots, setRoots] = useState<RootSummary[]>([]);
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [busy, setBusy] = useState(false);
  const pager = useAssetPager(
    props.bridge,
    props.session.sessionId,
    query,
    props.invalidations.assets,
  );
  const refreshSummary = pager.refreshSummary;
  const editor = useAssetEditor(props.bridge, props.session.sessionId, selected, props.invalidations.detail, useCallback((detail) => {
    refreshSummary(detail);
    setSelected((current) => current?.assetId === detail.assetId ? {
      ...current,
      displayName: detail.customTitle ?? detail.originalDisplayName,
      relativeDisplayPath: detail.relativeDisplayPath,
      availability: detail.availability,
      reviewState: detail.reviewState,
      customTitle: detail.customTitle,
      revision: detail.revision,
    } : current);
  }, [refreshSummary]));

  useEffect(() => {
    let active = true;
    void props.bridge.readPreferences().then((preferences) => {
      if (!active) return;
      setInterfaceScale(preferences.interfaceScale);
      setThumbnailSize(preferences.thumbnailDensity);
      setPreviewZoom(preferences.previewZoom);
    }).catch((reason) => props.setShellError(messageFrom(reason)));
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
  }, [pager.items, preview, selected]);

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

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div><p className="eyebrow">Editorial Contact Sheet</p><h1>{props.session.name}</h1></div>
        <div className="topbar__controls">
          <label>Interface<select value={interfaceScale} onChange={(event) => { const value = Number(event.target.value) as InterfaceScale; setInterfaceScale(value); writePreferences({ interfaceScale: value }); }}>{INTERFACE_SCALES.map((scale) => <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>)}</select></label>
          <label>Thumbnail density<input aria-label="Thumbnail density" max="340" min="140" step="20" type="range" value={thumbnailSize} onChange={(event) => { const value = Number(event.target.value); setThumbnailSize(value); writePreferences({ thumbnailDensity: value }); }} /></label>
          <button className="button--secondary" disabled={busy} onClick={closeLibrary}>Close Library</button>
        </div>
        <QueryToolbar query={query} roots={roots} disabled={busy || props.needsRestart} onChange={applyQuery} />
      </header>
      <LibrarySidebar
        bridge={props.bridge}
        sessionId={props.session.sessionId}
        total={pager.total}
        selectedCollectionId={query.collectionId}
        rootRevision={props.invalidations.roots}
        collectionRevision={props.invalidations.collections}
        disabled={busy || props.needsRestart}
        onCollectionChange={(collectionId) => applyQuery({ ...query, collectionId })}
        onDeleteActiveCollection={(label, action) => requestTransition(label, async () => {
          await action();
          setQuery((current) => ({ ...current, collectionId: null }));
          setPreview(null);
        })}
        onError={props.setShellError}
        onCollectionInventory={setCollections}
        onRootInventory={setRoots}
        onSession={props.onSession}
      />
      <section className="workspace-main" aria-label="Assets">
        {props.shellError && <div className="error-banner" role="alert"><span>{props.shellError}</span>{props.needsRestart && <button onClick={restartCore}>Restart Core</button>}</div>}
        {pager.error ? <WorkspaceState kind="error" title="Library query failed" detail={pager.error} action="Retry" onAction={pager.refresh} />
          : pager.loading && pager.total === 0 ? <WorkspaceState kind="status" title="Opening contact sheet" detail="Reading the first bounded Asset window…" />
          : pager.total === 0 ? <WorkspaceState
              title={query.search || query.rootId || query.collectionId || query.reviewStates.length || query.availability.length ? "No Assets match this view" : "This Library has no Assets yet"}
              detail={query.search || query.rootId || query.collectionId || query.reviewStates.length || query.availability.length ? "Clear or change the current filters, or rescan an authorized Root." : "Add one Root containing supported images. Assets appear progressively."}
            />
          : <ContactSheet bridge={props.bridge} sessionId={props.session.sessionId} total={pager.total} items={pager.items} thumbnailSize={thumbnailSize} selectedAssetId={selected?.assetId ?? null} ensureWindow={pager.ensureWindow} onSelect={chooseAsset} onPreview={setPreview} />}
      </section>
      <AssetInspector
        bridge={props.bridge}
        sessionId={props.session.sessionId}
        detail={editor.detail}
        draft={editor.draft}
        collections={collections}
        loading={editor.loading}
        saving={editor.saving}
        dirty={editor.dirty}
        error={editor.error}
        onDraft={editor.setDraft}
        onSave={editor.save}
        onDiscard={editor.discard}
        onReload={editor.reload}
        onError={props.setShellError}
      />
      <div className="selection-announcer" aria-live="polite">{selected ? `Selected ${selected.displayName}` : "No Asset selected"}</div>
      {preview && <AssetPreview asset={preview} source={props.bridge.assetResourceUrl({ sessionId: props.session.sessionId, assetId: preview.assetId, profile: "preview" })} initialZoom={previewZoom} onZoomChange={(value) => { setPreviewZoom(value); writePreferences({ previewZoom: value }); }} onClose={() => { const assetId = preview.assetId; setPreview(null); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-asset-id="${assetId}"]`)?.focus()); }} />}
      {pending && <TransitionDialog label={pending.label} dirty={pending.dirty} canSave={assetDraftErrors(editor.draft).length === 0} onChoice={(choice) => void resolveTransition(choice)} />}
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

function messageFrom(reason: unknown): string {
  return safeErrorMessage(reason, "Reference Library operation failed.");
}
