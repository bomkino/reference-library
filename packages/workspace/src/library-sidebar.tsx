import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MAX_COLLECTION_NAME_SCALARS,
  type CollectionSummary,
  type ReferenceWorkspaceBridge,
  type RootSummary,
  type SessionOpened,
} from "@pitchdog/reference-bridge";
import { textLimitError } from "./text-boundaries";
import { handleDialogKey } from "./dialog-keys";
import { safeErrorMessage } from "./safe-errors";

export function LibrarySidebar(props: {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  total: number;
  drawerOpen: boolean;
  selectedCollectionId: string | null;
  rootRevision: number;
  collectionRevision: number;
  disabled?: boolean;
  onAddRoot(): void;
  onCollectionChange(collectionId: string | null): void;
  onClose(): void;
  onDeleteActiveCollection(label: string, action: () => Promise<void>): void;
  onError(message: string): void;
  onCollectionInventory(collections: CollectionSummary[]): void;
  onRootInventory(roots: RootSummary[]): void;
  onSession(session: SessionOpened): void;
  onModalChange(open: boolean): void;
}) {
  const [roots, setRoots] = useState<RootSummary[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<CollectionSummary | null>(null);
  const [rename, setRename] = useState("");
  const [deleting, setDeleting] = useState<CollectionSummary | null>(null);
  const [authorityBusy, setAuthorityBusy] = useState(false);
  const renameInput = useRef<HTMLInputElement>(null);
  const deleteConfirm = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const allAssets = useRef<HTMLButtonElement>(null);
  const rootRequest = useRef(0);
  const collectionRequest = useRef(0);
  const restoreFocus = () => requestAnimationFrame(() => {
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    else allAssets.current?.focus();
  });

  const loadRoots = useCallback(async (sessionId = props.sessionId) => {
    const current = ++rootRequest.current;
    try {
      const nextRoots = await props.bridge.listRoots(sessionId);
      if (current !== rootRequest.current) return;
      setRoots(nextRoots);
      props.onRootInventory(nextRoots);
    } catch (reason) {
      if (current === rootRequest.current) props.onError(messageFrom(reason));
    }
  }, [props.bridge, props.onError, props.onRootInventory, props.sessionId]);

  const loadCollections = useCallback(async (sessionId = props.sessionId) => {
    const current = ++collectionRequest.current;
    try {
      const nextCollections = await props.bridge.listCollections(sessionId);
      if (current !== collectionRequest.current) return;
      setCollections(nextCollections);
      props.onCollectionInventory(nextCollections);
    } catch (reason) {
      if (current === collectionRequest.current) props.onError(messageFrom(reason));
    }
  }, [props.bridge, props.onCollectionInventory, props.onError, props.sessionId]);

  useEffect(() => {
    void loadRoots();
    return () => { rootRequest.current += 1; };
  }, [loadRoots, props.rootRevision]);
  useEffect(() => {
    void loadCollections();
    return () => { collectionRequest.current += 1; };
  }, [loadCollections, props.collectionRevision]);
  useEffect(() => { if (editing) renameInput.current?.focus(); }, [editing]);
  useLayoutEffect(() => {
    if (!deleting) return;
    const frame = requestAnimationFrame(() => deleteConfirm.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [deleting]);
  useEffect(() => {
    props.onModalChange(Boolean(deleting));
    return () => props.onModalChange(false);
  }, [deleting, props.onModalChange]);

  const dismissDelete = () => {
    setDeleting(null);
    restoreFocus();
  };

  const createError = textLimitError(newName, MAX_COLLECTION_NAME_SCALARS, "Collection name", true);
  const renameError = textLimitError(rename, MAX_COLLECTION_NAME_SCALARS, "Collection name", true);

  const createCollection = async () => {
    const name = newName.trim();
    if (!name || createError) return;
    try {
      await props.bridge.createCollection(props.sessionId, name);
      setNewName("");
      await loadCollections();
    } catch (reason) { props.onError(messageFrom(reason)); }
  };

  const saveRename = async () => {
    const name = rename.trim();
    if (!editing || !name || renameError) return;
    try {
      await props.bridge.renameCollection(props.sessionId, editing.collectionId, editing.revision, name);
      setEditing(null);
      await loadCollections();
      restoreFocus();
    } catch (reason) { props.onError(messageFrom(reason)); }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    if (props.selectedCollectionId === deleting.collectionId) {
      const target = deleting;
      props.onDeleteActiveCollection(`Delete ${target.name}`, () => deleteCollection(target));
      setDeleting(null);
      return;
    }
    await deleteCollection(deleting);
  };

  const deleteCollection = async (target: CollectionSummary) => {
    try {
      await props.bridge.deleteCollection(props.sessionId, target.collectionId);
      setDeleting(null);
      await loadCollections();
      restoreFocus();
    } catch (reason) { props.onError(messageFrom(reason)); }
  };

  return (
    <aside
      className={`sidebar${props.drawerOpen ? " sidebar--drawer-open" : ""}`}
      id="library-navigation"
      aria-label="Library navigation"
      onKeyDownCapture={(event) => {
        if (deleting && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismissDelete();
        }
      }}
    >
      <header className="sidebar__header">
        <div>
          <p className="eyebrow">Library</p>
          <p className="sidebar__count">{props.total.toLocaleString()} {props.total === 1 ? "Asset" : "Assets"}</p>
        </div>
        <button className="button--quiet sidebar__close" onClick={props.onClose}>Close</button>
      </header>

      <section aria-labelledby="roots-heading">
        <div className="section-heading">
          <h2 id="roots-heading">Roots</h2>
          <button className="button--quiet" data-add-root disabled={props.disabled || authorityBusy} onClick={props.onAddRoot}>Add Root</button>
        </div>
        {roots.length === 0 ? <p className="muted">No Root authorized.</p> : (
          <ul className="plain-list">
            {roots.map((root) => (
              <li className="root-row" key={root.rootId}>
                <div><strong>{root.displayName}</strong><span role="status">{rootStateLabel(root.state)} · {root.observedCount.toLocaleString()} observed{root.unsupportedCount ? ` · ${root.unsupportedCount.toLocaleString()} unsupported` : ""}</span>{root.activeJobId && <progress aria-label={`Scanning ${root.displayName}`} />}</div>
                <div className="compact-actions">
                  {!root.authorized && <button disabled={props.disabled || authorityBusy} onClick={async () => {
                    setAuthorityBusy(true);
                    try {
                      const result = await props.bridge.reauthorizeRoot(props.sessionId, root.rootId);
                      if (!result) return;
                      props.onSession(result.session);
                    } catch (reason) { props.onError(messageFrom(reason)); }
                    finally { setAuthorityBusy(false); }
                  }}>Reauthorize</button>}
                  {root.activeJobId ? (
                    <button disabled={props.disabled || authorityBusy} onClick={async () => { try { await props.bridge.cancelJob(props.sessionId, root.activeJobId!); await loadRoots(); } catch (reason) { props.onError(messageFrom(reason)); } }}>Cancel</button>
                  ) : (
                    <button className="button--quiet" disabled={props.disabled || authorityBusy || !root.authorized} onClick={async () => { try { await props.bridge.scanRoot(props.sessionId, root.rootId); await loadRoots(); } catch (reason) { props.onError(messageFrom(reason)); } }}>Rescan</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="collections-heading">
        <h2 id="collections-heading">Collections</h2>
        <button ref={allAssets} className={props.selectedCollectionId === null ? "nav-choice nav-choice--active" : "nav-choice"} disabled={props.disabled} onClick={() => { props.onCollectionChange(null); props.onClose(); }}>All Assets</button>
        <ul className="plain-list">
          {collections.map((collection) => (
            <li className="collection-row" key={collection.collectionId}>
              {editing?.collectionId === collection.collectionId ? (
                <form onSubmit={(event) => { event.preventDefault(); void saveRename(); }}>
                  <input ref={renameInput} aria-label={`Rename ${collection.name}`} aria-invalid={Boolean(renameError)} aria-describedby={renameError ? "rename-limit-error" : undefined} value={rename} onChange={(event) => setRename(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setEditing(null); restoreFocus(); } }} />
                  <button disabled={!rename.trim() || Boolean(renameError)} type="submit">Save</button>
                  <button className="button--quiet" type="button" onClick={() => { setEditing(null); restoreFocus(); }}>Cancel</button>
                  {renameError && <span className="field-error" id="rename-limit-error" role="alert">{renameError}</span>}
                </form>
              ) : (
                <>
                  <button className={props.selectedCollectionId === collection.collectionId ? "nav-choice nav-choice--active" : "nav-choice"} disabled={props.disabled} onClick={() => { props.onCollectionChange(collection.collectionId); props.onClose(); }}>{collection.name}<span>{collection.assetCount}</span></button>
                  <button className="icon-button" aria-label={`Rename ${collection.name}`} title={`Rename ${collection.name}`} disabled={props.disabled} onClick={(event) => { returnFocus.current = event.currentTarget; setEditing(collection); setRename(collection.name); }}><span className="ui-icon ui-icon--edit" aria-hidden="true" /></button>
                  <button className="icon-button" aria-label={`Delete ${collection.name}`} title={`Delete ${collection.name}`} disabled={props.disabled} onClick={(event) => { returnFocus.current = event.currentTarget; setDeleting(collection); }}><span className="ui-icon ui-icon--trash" aria-hidden="true" /></button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form className="collection-create" onSubmit={(event) => { event.preventDefault(); void createCollection(); }}>
          <label>New Collection<input aria-invalid={Boolean(createError)} aria-describedby={createError ? "collection-limit-error" : undefined} disabled={props.disabled} value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
          <button disabled={props.disabled || !newName.trim() || Boolean(createError)} type="submit">Create</button>
          {createError && <span className="field-error" id="collection-limit-error" role="alert">{createError}</span>}
        </form>
      </section>

      {deleting && createPortal(
        <div className="confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onKeyDown={(event) => handleDialogKey(event, dismissDelete)}>
          <h3 id="delete-title">Delete “{deleting.name}”?</h3>
          <p>Assets and original files remain unchanged.</p>
          <div className="button-row"><button ref={deleteConfirm} autoFocus onClick={() => void confirmDelete()}>Delete Collection</button><button className="button--secondary" onClick={dismissDelete}>Cancel</button></div>
        </div>,
        document.body,
      )}
    </aside>
  );
}

function messageFrom(reason: unknown): string {
  return safeErrorMessage(reason, "Library operation failed.");
}

function rootStateLabel(value: string): string {
  const labels: Record<string, string> = {
    ready: "Ready",
    scanning: "Scanning",
    needs_permission: "Needs permission",
    missing: "Missing",
    failed: "Scan failed",
    cancelled: "Scan cancelled",
  };
  const words = value.replaceAll("_", " ").trim();
  return labels[value] ?? (words ? words[0]!.toUpperCase() + words.slice(1) : "Unknown");
}
