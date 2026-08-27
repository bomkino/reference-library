import {
  MAX_ASSET_NOTE_SCALARS,
  MAX_ASSET_TITLE_SCALARS,
  type AssetDetail,
  type CollectionSummary,
  type ReferenceWorkspaceBridge,
} from "@pitchdog/reference-bridge";
import type { AssetDraft } from "./use-asset-editor";
import { safeRelativeDisplayPath, textLimitError } from "./text-boundaries";
import { safeErrorMessage } from "./safe-errors";

export function AssetInspector(props: {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  detail: AssetDetail | null;
  draft: AssetDraft | null;
  collections: CollectionSummary[];
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  onDraft(draft: AssetDraft): void;
  onSave(): Promise<boolean>;
  onDiscard(): void;
  onReload(): Promise<void>;
  onError(message: string): void;
}) {
  const titleError = props.draft ? textLimitError(props.draft.title, MAX_ASSET_TITLE_SCALARS, "Title") : null;
  const noteError = props.draft ? textLimitError(props.draft.note, MAX_ASSET_NOTE_SCALARS, "Note") : null;
  const cannotSave = Boolean(titleError || noteError || props.saving);

  if (props.loading) return <aside className="inspector" aria-label="Inspector" aria-busy="true"><h2>Inspector</h2><p role="status">Loading Asset…</p></aside>;
  if (!props.detail || !props.draft) return <aside className="inspector" aria-label="Inspector"><h2>Inspector</h2><p className="muted">Select an Asset. Inspector geometry stays put.</p></aside>;

  const detail = props.detail;
  const draft = props.draft;
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="section-heading"><h2>Inspector</h2>{props.dirty && <span className="draft-mark" role="status">Edited</span>}</div>
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
        Review
        <select value={draft.reviewState} onChange={(event) => props.onDraft({ ...draft, reviewState: event.target.value as AssetDraft["reviewState"] })}>
          <option value="unreviewed">Unreviewed</option>
          <option value="keep">Keep</option>
          <option value="maybe">Maybe</option>
          <option value="reject">Reject</option>
        </select>
      </label>
      <label>
        Note
        <textarea
          aria-invalid={Boolean(noteError)}
          aria-describedby={noteError ? "note-limit-error" : undefined}
          rows={7}
          value={draft.note}
          onChange={(event) => props.onDraft({ ...draft, note: event.target.value })}
        />
      </label>
      {noteError && <p className="field-error" id="note-limit-error" role="alert">{noteError}</p>}
      <div className="button-row inspector__save-row">
        <button disabled={!props.dirty || cannotSave} onClick={() => void props.onSave()}>Save</button>
        <button className="button--secondary" disabled={!props.dirty || props.saving} onClick={props.onDiscard}>Discard</button>
      </div>
      {props.error && <p className="field-error" role="alert">{props.error}</p>}
      <dl>
        <dt>Original</dt><dd>{detail.originalDisplayName}</dd>
        <dt>Source</dt><dd className="relative-path">{safeRelativeDisplayPath(detail.relativeDisplayPath)}</dd>
        <dt>Availability</dt><dd>{detail.availability}</dd>
        <dt>Media</dt><dd>{detail.mediaFamily}</dd>
      </dl>
      <button className="button--secondary" onClick={() => void props.bridge.revealLocation(props.sessionId, detail.locationId).catch((reason) => props.onError(messageFrom(reason)))}>Reveal Source</button>
      <fieldset className="membership" disabled={props.dirty || props.saving}>
        <legend>Collections</legend>
        {props.collections.length === 0 ? <p className="muted">No Collections yet.</p> : props.collections.map((collection) => {
          const checked = detail.collectionIds.includes(collection.collectionId);
          return <label key={collection.collectionId}><input type="checkbox" checked={checked} onChange={async (event) => {
            try {
              await props.bridge.setCollectionMembership({ sessionId: props.sessionId, collectionId: collection.collectionId, assetIds: [detail.assetId], member: event.target.checked });
              await props.onReload();
            } catch (reason) { props.onError(messageFrom(reason)); }
          }} />{collection.name}</label>;
        })}
      </fieldset>
    </aside>
  );
}

function messageFrom(reason: unknown): string {
  return safeErrorMessage(reason, "Asset operation failed.");
}
