import { useState, type KeyboardEvent } from "react";
import {
  MAX_ASSET_NOTE_SCALARS,
  MAX_ASSET_TITLE_SCALARS,
  MAX_ASSET_TOKENS,
  MAX_ASSET_TOKEN_SCALARS,
  type AssetDetail,
  type CollectionSummary,
  type ReferenceWorkspaceBridge,
} from "@pitchdog/reference-bridge";
import type { AssetDraft } from "./use-asset-editor";
import { normalizeTokens } from "./use-asset-editor";
import { safeRelativeDisplayPath, textLimitError } from "./text-boundaries";
import { safeErrorMessage } from "./safe-errors";

export function AssetInspector(props: {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  detail: AssetDetail | null;
  draft: AssetDraft | null;
  collections: CollectionSummary[];
  drawerOpen: boolean;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  onDraft(draft: AssetDraft): void;
  onSave(): Promise<boolean>;
  onDiscard(): void;
  onReload(): Promise<void>;
  onPreview(detail: AssetDetail): void;
  onClose(): void;
  onError(message: string): void;
}) {
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const titleError = props.draft ? textLimitError(props.draft.title, MAX_ASSET_TITLE_SCALARS, "Title") : null;
  const noteError = props.draft ? textLimitError(props.draft.note, MAX_ASSET_NOTE_SCALARS, "Note") : null;
  const tokenErrors = props.draft ? tokenFieldErrors(props.draft) : { tags: null, usedIn: null };
  const cannotSave = Boolean(titleError || noteError || tokenErrors.tags || tokenErrors.usedIn || props.saving);

  if (props.loading) return <aside className={`inspector${props.drawerOpen ? " inspector--drawer-open" : ""}`} id="asset-inspector" aria-label="Inspector" aria-busy="true"><div className="inspector-empty"><p className="eyebrow">Inspector</p><h2>Loading reference…</h2></div></aside>;
  if (!props.detail || !props.draft) {
    return (
      <aside className={`inspector inspector--empty${props.drawerOpen ? " inspector--drawer-open" : ""}`} id="asset-inspector" aria-label="Inspector">
        <div className="inspector-empty">
          <div className="section-heading">
            <p className="eyebrow">Inspector</p>
            <button className="button--quiet inspector__close" onClick={props.onClose}>Close</button>
          </div>
          <h2>{props.error ? "Reference unavailable" : "Choose a reference."}</h2>
          {props.error ? (
            <>
              <p className="field-error" role="alert">{props.error}</p>
              <button className="button--secondary" onClick={() => void props.onReload()}>Retry Reference</button>
            </>
          ) : (
            <>
              <p className="muted">Select a card to preview it, record the decision, and keep its place in the deck.</p>
              <dl className="inspector-empty__keys">
                <div><dt><kbd>1 / 2 / 3</kbd></dt><dd>Keep, Maybe, Reject</dd></div>
                <div><dt><kbd>X</kbd></dt><dd>Shortlist the selected reference</dd></div>
                <div><dt><kbd>C</kbd></dt><dd>Compare shortlisted work</dd></div>
              </dl>
            </>
          )}
        </div>
      </aside>
    );
  }

  const detail = props.detail;
  const draft = props.draft;
  const sourceAvailable = detail.availability === "present" || detail.availability === "unsupported";
  const nativeAction = async (action: "open" | "reveal" | "copy") => {
    setActionStatus(null);
    try {
      if (action === "open") await props.bridge.openLocation(props.sessionId, detail.locationId);
      else if (action === "reveal") await props.bridge.revealLocation(props.sessionId, detail.locationId);
      else await props.bridge.copyLocationPath(props.sessionId, detail.locationId);
      if (action === "copy") setActionStatus("Path copied.");
    } catch (reason) {
      props.onError(safeErrorMessage(reason, "Asset operation failed."));
    }
  };

  return (
    <aside className={`inspector inspector--active${props.drawerOpen ? " inspector--drawer-open" : ""}`} id="asset-inspector" aria-label="Inspector">
      <InspectorVisual bridge={props.bridge} sessionId={props.sessionId} detail={detail} onPreview={() => props.onPreview(detail)} />

      <div className="inspector__identity">
        <div>
          <p className="eyebrow">Selected reference</p>
          <h2>{detail.customTitle ?? detail.originalDisplayName}</h2>
          <p>{detail.category} · {detail.extension ? `.${detail.extension}` : detail.mediaFamily} · {formatBytes(detail.byteSize)}</p>
        </div>
        <div className="inspector__heading-actions">
          {props.dirty && <span className="draft-mark" role="status">Unsaved</span>}
          <button className="button--quiet inspector__close" onClick={props.onClose}>Close</button>
        </div>
      </div>

      <div className="inspector__source-actions">
        <button disabled={!sourceAvailable} onClick={() => void nativeAction("open")}>Open Original</button>
        <button className="button--secondary" disabled={!sourceAvailable} onClick={() => void nativeAction("reveal")}>Reveal</button>
        <button className="button--quiet" disabled={!sourceAvailable} onClick={() => void nativeAction("copy")}>Copy path</button>
      </div>
      {actionStatus && <p className="inline-status" role="status">{actionStatus}</p>}

      <section className="inspector__decision" aria-labelledby="review-heading">
        <div className="inspector__section-heading">
          <h3 id="review-heading">Editorial decision</h3>
          <span>1 / 2 / 3 / 0</span>
        </div>
        <div className="review-segment" role="group" aria-label="Review state">
          {(["keep", "maybe", "reject"] as AssetDraft["reviewState"][]).map((reviewState) => (
            <button
              className={`review-choice review-choice--${reviewState}`}
              aria-pressed={draft.reviewState === reviewState}
              key={reviewState}
              type="button"
              onClick={() => props.onDraft({ ...draft, reviewState })}
            >
              {reviewState[0]?.toUpperCase()}{reviewState.slice(1)}
            </button>
          ))}
          <button className="button--quiet" aria-pressed={draft.reviewState === "unreviewed"} type="button" onClick={() => props.onDraft({ ...draft, reviewState: "unreviewed" })}>Clear</button>
        </div>
      </section>

      <section className="inspector__section inspector__editorial-fields">
        <label>
          Title
          <input
            aria-invalid={Boolean(titleError)}
            aria-describedby={titleError ? "title-limit-error" : undefined}
            value={draft.title}
            onChange={(event) => props.onDraft({ ...draft, title: event.target.value })}
          />
        </label>
        {titleError && <p className="field-error" id="title-limit-error" role="alert">{titleError}</p>}
        <label>
          Note
          <textarea
            aria-invalid={Boolean(noteError)}
            aria-describedby={noteError ? "note-limit-error" : undefined}
            rows={5}
            placeholder="Why this reference matters, what to steal, what to avoid…"
            value={draft.note}
            onChange={(event) => props.onDraft({ ...draft, note: event.target.value })}
          />
        </label>
        {noteError && <p className="field-error" id="note-limit-error" role="alert">{noteError}</p>}
        <TokenEditor
          label="Tags"
          placeholder="Add a tag"
          values={draft.tags}
          error={tokenErrors.tags}
          onChange={(tags) => props.onDraft({ ...draft, tags })}
        />
        <TokenEditor
          label="Used in"
          placeholder="Cover, Slide 07, V2"
          values={draft.usedIn}
          error={tokenErrors.usedIn}
          onChange={(usedIn) => props.onDraft({ ...draft, usedIn })}
        />
        {props.error && <p className="field-error" role="alert">{props.error}</p>}
      </section>

      <details className="inspector__disclosure">
        <summary>File details <span>{detail.availability}</span></summary>
        <dl>
          <dt>Original</dt><dd>{detail.originalDisplayName}</dd>
          <dt>Category</dt><dd>{detail.category}</dd>
          <dt>Type</dt><dd>{detail.extension ? `.${detail.extension}` : detail.mediaFamily}</dd>
          <dt>Media</dt><dd>{detail.mediaFamily}</dd>
          <dt>MIME</dt><dd>{detail.mimeType}</dd>
          <dt>Size</dt><dd>{formatBytes(detail.byteSize)}</dd>
          <dt>Availability</dt><dd>{detail.availability}</dd>
          <dt>Source</dt><dd className="relative-path">{safeRelativeDisplayPath(detail.relativeDisplayPath)}</dd>
        </dl>
      </details>

      <details className="inspector__disclosure">
        <summary>Collections <span>{detail.collectionIds.length}</span></summary>
        <fieldset className="membership" disabled={props.dirty || props.saving}>
          <legend className="visually-hidden">Collections</legend>
          {props.collections.length === 0 ? <p className="muted">No Collections yet.</p> : props.collections.map((collection) => {
            const checked = detail.collectionIds.includes(collection.collectionId);
            return <label key={collection.collectionId}><input type="checkbox" checked={checked} onChange={async (event) => {
              try {
                await props.bridge.setCollectionMembership({ sessionId: props.sessionId, collectionId: collection.collectionId, assetIds: [detail.assetId], member: event.target.checked });
                await props.onReload();
              } catch (reason) { props.onError(safeErrorMessage(reason, "Collection membership failed.")); }
            }} />{collection.name}</label>;
          })}
        </fieldset>
      </details>

      <div className="inspector__save-dock">
        <span>{props.dirty ? "Changes not yet in the Library." : "All changes saved."}</span>
        <div>
          <button disabled={!props.dirty || cannotSave} onClick={() => void props.onSave()}>{props.saving ? "Saving…" : "Save Changes"}</button>
          <button className="button--quiet" disabled={!props.dirty || props.saving} onClick={props.onDiscard}>Discard</button>
        </div>
      </div>
    </aside>
  );
}

function InspectorVisual(props: {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  detail: AssetDetail;
  onPreview(): void;
}) {
  const [failed, setFailed] = useState(false);
  const image = props.detail.availability === "present" && props.detail.previewKind === "image" && !failed;
  return (
    <button
      className="inspector__visual"
      disabled={props.detail.previewKind === "none" || props.detail.availability !== "present"}
      title={props.detail.previewKind === "none" ? "No in-app preview for this format" : "Open Preview"}
      type="button"
      onClick={props.onPreview}
    >
      {image ? (
        <img
          alt=""
          aria-hidden
          src={props.bridge.assetResourceUrl({ sessionId: props.sessionId, assetId: props.detail.assetId, profile: "grid_standard" })}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="inspector__visual-placeholder">
          <strong>{props.detail.extension?.toUpperCase() ?? props.detail.mediaFamily.toUpperCase()}</strong>
          <small>{props.detail.previewKind === "none" ? "Catalogue only" : props.detail.availability}</small>
        </span>
      )}
      {props.detail.previewKind !== "none" && props.detail.availability === "present" && <span className="inspector__visual-action">Open Preview</span>}
    </button>
  );
}

function TokenEditor(props: {
  label: string;
  placeholder: string;
  values: string[];
  error: string | null;
  onChange(values: string[]): void;
}) {
  const [input, setInput] = useState("");
  const commit = () => {
    const additions = input.split(/[,\n]/).map((value) => value.trim()).filter(Boolean);
    if (additions.length === 0) return;
    props.onChange(normalizeTokens([...props.values, ...additions]));
    setInput("");
  };
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Backspace" && !input && props.values.length > 0) {
      props.onChange(props.values.slice(0, -1));
    }
  };
  return (
    <div className="token-field">
      <span className="token-field__label">{props.label}</span>
      <div className="token-field__box" data-invalid={Boolean(props.error) || undefined}>
        {props.values.map((value) => (
          <span className="token" key={value}>{value}<button aria-label={`Remove ${value}`} type="button" onClick={() => props.onChange(props.values.filter((item) => item !== value))}>×</button></span>
        ))}
        <input
          aria-label={props.label}
          placeholder={props.values.length === 0 ? props.placeholder : "Add another"}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onBlur={commit}
          onKeyDown={handleKey}
        />
      </div>
      {props.error && <p className="field-error" role="alert">{props.error}</p>}
    </div>
  );
}

function tokenFieldErrors(draft: AssetDraft): { tags: string | null; usedIn: string | null } {
  const validate = (values: string[], label: string) => {
    if (normalizeTokens(values).length > MAX_ASSET_TOKENS) return `${label} supports up to ${MAX_ASSET_TOKENS} entries.`;
    if (values.some((value) => [...value].length > MAX_ASSET_TOKEN_SCALARS)) return `${label} entries must be ${MAX_ASSET_TOKEN_SCALARS} characters or fewer.`;
    return null;
  };
  return { tags: validate(draft.tags, "Tags"), usedIn: validate(draft.usedIn, "Used in") };
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
