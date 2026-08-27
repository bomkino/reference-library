import { useEffect, useRef, useState } from "react";
import {
  MAX_COLLECTION_NAME_SCALARS,
  type CollectionSummary,
  type ReferenceWorkspaceBridge,
  type RootSummary,
} from "@pitchdog/reference-bridge";
import { textLimitError } from "./text-boundaries";
import { handleDialogKey } from "./dialog-keys";
import { safeErrorMessage } from "./safe-errors";

export function LibrarySidebar(props: {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  total: number;
  selectedCollectionId: string | null;
  revisionPulse: number;
  disabled?: boolean;
  onCollectionChange(collectionId: string | null): void;
  onDeleteActiveCollection(label: string, action: () => Promise<void>): void;
  onError(message: string): void;
  onCollectionInventory(collections: CollectionSummary[]): void;
  onRootInventory(roots: RootSummary[]): void;
}) {
  const [roots, setRoots] = useState<RootSummary[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<CollectionSummary | null>(null);
  const [rename, setRename] = useState("");
  const [deleting, setDeleting] = useState<CollectionSummary | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const allAssets = useRef<HTMLButtonElement>(null);
  const restoreFocus = () => requestAnimationFrame(() => {
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    else allAssets.current?.focus();
  });

  const load = async () => {
    try {
      const [nextRoots, nextCollections] = await Promise.all([
        props.bridge.listRoots(props.sessionId),
        props.bridge.listCollections(props.sessionId),
      ]);
      setRoots(nextRoots);
      props.onRootInventory(nextRoots);
      setCollections(nextCollections);
      props.onCollectionInventory(nextCollections);
    } catch (reason) {
      props.onError(messageFrom(reason));
    }
  };

  useEffect(() => { void load(); }, [props.revisionPulse, props.sessionId]);
  useEffect(() => { if (editing) renameInput.current?.focus(); }, [editing]);

  const createError = textLimitError(newName, MAX_COLLECTION_NAME_SCALARS, "Collection name", true);
  const renameError = textLimitError(rename, MAX_COLLECTION_NAME_SCALARS, "Collection name", true);

  const createCollection = async () => {
    const name = newName.trim();
    if (!name || createError) return;
    try {
      await props.bridge.createCollection(props.sessionId, name);
      setNewName("");
      await load();
    } catch (reason) { props.onError(messageFrom(reason)); }
  };

  const saveRename = async () => {
    const name = rename.trim();
    if (!editing || !name || renameError) return;
    try {
      await props.bridge.renameCollection(props.sessionId, editing.collectionId, editing.revision, name);
      setEditing(null);
      await load();
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
      await load();
      restoreFocus();
    } catch (reason) { props.onError(messageFrom(reason)); }
  };

  return (
    <aside className="sidebar" aria-label="Library navigation">
      <div>
        <p className="eyebrow">Library</p>
        <p className="sidebar__count">{props.total.toLocaleString()} {props.total === 1 ? "Asset" : "Assets"}</p>
      </div>

      <section aria-labelledby="roots-heading">
        <div className="section-heading">
          <h2 id="roots-heading">Roots</h2>
          <button className="button--quiet" disabled={props.disabled} onClick={async () => {
            try { await props.bridge.chooseRoot(props.sessionId); await load(); } catch (reason) { props.onError(messageFrom(reason)); }
          }}>Add</button>
        </div>
        {roots.length === 0 ? <p className="muted">No Root authorized.</p> : (
          <ul className="plain-list">
            {roots.map((root) => (
              <li className="root-row" key={root.rootId}>
                <div><strong>{root.displayName}</strong><span role="status">{root.state} · {root.observedCount.toLocaleString()} observed{root.unsupportedCount ? ` · ${root.unsupportedCount.toLocaleString()} unsupported` : ""}</span>{root.activeJobId && <progress aria-label={`Scanning ${root.displayName}`} />}</div>
                <div className="compact-actions">
                  {!root.authorized && <button disabled={props.disabled} onClick={async () => { try { await props.bridge.reauthorizeRoot(props.sessionId, root.rootId); await load(); } catch (reason) { props.onError(messageFrom(reason)); } }}>Reauthorize</button>}
                  {root.activeJobId ? (
                    <button disabled={props.disabled} onClick={async () => { try { await props.bridge.cancelJob(props.sessionId, root.activeJobId!); await load(); } catch (reason) { props.onError(messageFrom(reason)); } }}>Cancel</button>
                  ) : (
                    <button className="button--quiet" disabled={props.disabled || !root.authorized} onClick={async () => { try { await props.bridge.scanRoot(props.sessionId, root.rootId); await load(); } catch (reason) { props.onError(messageFrom(reason)); } }}>Rescan</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="collections-heading">
        <h2 id="collections-heading">Collections</h2>
        <button ref={allAssets} className={props.selectedCollectionId === null ? "nav-choice nav-choice--active" : "nav-choice"} disabled={props.disabled} onClick={() => props.onCollectionChange(null)}>All Assets</button>
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
                  <button className={props.selectedCollectionId === collection.collectionId ? "nav-choice nav-choice--active" : "nav-choice"} disabled={props.disabled} onClick={() => props.onCollectionChange(collection.collectionId)}>{collection.name}<span>{collection.assetCount}</span></button>
                  <button className="icon-button" aria-label={`Rename ${collection.name}`} disabled={props.disabled} onClick={(event) => { returnFocus.current = event.currentTarget; setEditing(collection); setRename(collection.name); }}>Rename</button>
                  <button className="icon-button" aria-label={`Delete ${collection.name}`} disabled={props.disabled} onClick={(event) => { returnFocus.current = event.currentTarget; setDeleting(collection); }}>Delete</button>
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

      {deleting && (
        <div className="confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onKeyDown={(event) => handleDialogKey(event, () => { setDeleting(null); restoreFocus(); })}>
          <h3 id="delete-title">Delete “{deleting.name}”?</h3>
          <p>Assets and original files remain unchanged.</p>
          <div className="button-row"><button autoFocus onClick={() => void confirmDelete()}>Delete Collection</button><button className="button--secondary" onClick={() => { setDeleting(null); restoreFocus(); }}>Cancel</button></div>
        </div>
      )}
    </aside>
  );
}

function messageFrom(reason: unknown): string {
  return safeErrorMessage(reason, "Library operation failed.");
}
