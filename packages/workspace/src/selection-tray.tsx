import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Columns, X } from "@phosphor-icons/react";
import type {
  AssetSummary,
  CollectionSummary,
  ReferenceWorkspaceBridge,
  ReviewState,
} from "@pitchdog/reference-bridge";
import { MAX_COMPARE_ASSETS } from "./selection";
import { UiIcon } from "./ui-icon";

export function SelectionTray(props: {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  assets: readonly AssetSummary[];
  collections: readonly CollectionSummary[];
  busy: boolean;
  status: string | null;
  onInspect(asset: AssetSummary): void;
  onMove(assetId: string, direction: -1 | 1): void;
  onRemove(assetId: string): void;
  onClear(): void;
  onCompare(): void;
  onReview(reviewState: ReviewState): void;
  onAddTags(value: string, onAccepted: () => void): boolean;
  onAddUsedIn(value: string, onAccepted: () => void): boolean;
  onAddCollection(collectionId: string, onAccepted: () => void): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [usedInInput, setUsedInInput] = useState("");
  const [collectionId, setCollectionId] = useState("");

  const submitTags = (event: FormEvent) => {
    event.preventDefault();
    props.onAddTags(tagInput, () => setTagInput(""));
  };
  const submitUsedIn = (event: FormEvent) => {
    event.preventDefault();
    props.onAddUsedIn(usedInInput, () => setUsedInInput(""));
  };

  return (
    <aside className={`selection-tray${expanded ? " selection-tray--expanded" : ""}`} aria-label={`Shortlist, ${props.assets.length} assets`} aria-busy={props.busy}>
      <header className="selection-tray__header">
        <div className="selection-tray__title">
          <p className="eyebrow">Shortlist</p>
          <h2>{props.assets.length} shortlisted</h2>
          <p>{Math.min(props.assets.length, MAX_COMPARE_ASSETS)} in Compare slots</p>
        </div>
        <div className="selection-tray__headline-actions">
          <button
            data-compare-trigger
            disabled={props.busy || props.assets.length < 2}
            onClick={props.onCompare}
          >
            <UiIcon icon={Columns} />{" "}Compare {props.assets.length > MAX_COMPARE_ASSETS ? `first ${MAX_COMPARE_ASSETS}` : ""}
          </button>
          <button
            className="button--secondary"
            aria-expanded={expanded}
            aria-controls="shortlist-batch-tools"
            disabled={props.busy}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Done" : "Batch edit"}
          </button>
          <button className="button--quiet" disabled={props.busy} onClick={props.onClear}>Clear</button>
        </div>
      </header>

      <div className="selection-tray__assets" role="list" aria-label="Shortlisted assets">
        {props.assets.map((asset, index) => (
          <div className={`selection-chip${index < MAX_COMPARE_ASSETS ? " selection-chip--compare-slot" : ""}`} role="listitem" key={asset.assetId}>
            <button
              className="selection-chip__asset"
              disabled={props.busy}
              title={`Inspect ${asset.displayName}`}
              onClick={() => props.onInspect(asset)}
            >
              <span className="selection-chip__index" aria-label={`Position ${index + 1}`}>{index + 1}</span>
              <TrayVisual bridge={props.bridge} sessionId={props.sessionId} asset={asset} />
              <span className="selection-chip__copy">
                <strong>{asset.displayName}</strong>
                <small>{asset.reviewState} · {asset.extension ? `.${asset.extension}` : asset.mediaFamily}</small>
              </span>
            </button>
            <span className="selection-chip__order" role="group" aria-label={`Reorder ${asset.displayName}`}>
              <button className="button--quiet" aria-label={`Move ${asset.displayName} earlier`} title={`Move ${asset.displayName} earlier`} disabled={props.busy || index === 0} onClick={() => props.onMove(asset.assetId, -1)}><UiIcon icon={ArrowLeft} /></button>
              <button className="button--quiet" aria-label={`Move ${asset.displayName} later`} title={`Move ${asset.displayName} later`} disabled={props.busy || index === props.assets.length - 1} onClick={() => props.onMove(asset.assetId, 1)}><UiIcon icon={ArrowRight} /></button>
            </span>
            <button
              className="selection-chip__remove"
              aria-label={`Remove ${asset.displayName} from shortlist`}
              title={`Remove ${asset.displayName} from shortlist`}
              disabled={props.busy}
              onClick={() => props.onRemove(asset.assetId)}
            >
              <UiIcon icon={X} />
            </button>
          </div>
        ))}
      </div>

      {expanded && (
        <div className="selection-tray__actions" id="shortlist-batch-tools">
          <fieldset disabled={props.busy}>
            <legend>Batch review</legend>
            <div className="selection-tray__review-buttons">
              <button className="review-choice review-choice--keep" onClick={() => props.onReview("keep")}>Keep</button>
              <button className="review-choice review-choice--maybe" onClick={() => props.onReview("maybe")}>Maybe</button>
              <button className="review-choice review-choice--reject" onClick={() => props.onReview("reject")}>Reject</button>
              <button className="button--quiet" onClick={() => props.onReview("unreviewed")}>Clear review</button>
            </div>
          </fieldset>

          <form onSubmit={submitTags}>
            <label>
              Add tags
              <span className="selection-tray__inline-form">
                <input value={tagInput} placeholder="night, cover" onChange={(event) => setTagInput(event.target.value)} />
                <button disabled={props.busy || !tagInput.trim()} type="submit">Add</button>
              </span>
            </label>
          </form>

          <form onSubmit={submitUsedIn}>
            <label>
              Used in
              <span className="selection-tray__inline-form">
                <input value={usedInInput} placeholder="Cover, Slide 07" onChange={(event) => setUsedInInput(event.target.value)} />
                <button disabled={props.busy || !usedInInput.trim()} type="submit">Add</button>
              </span>
            </label>
          </form>

          <label>
            Add to Collection
            <span className="selection-tray__inline-form">
              <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
                <option value="">Choose…</option>
                {props.collections.map((collection) => (
                  <option key={collection.collectionId} value={collection.collectionId}>{collection.name}</option>
                ))}
              </select>
              <button
                disabled={props.busy || !collectionId}
                onClick={() => props.onAddCollection(collectionId, () => setCollectionId(""))}
                type="button"
              >
                Add
              </button>
            </span>
          </label>
        </div>
      )}

      {props.status && (
        <footer className="selection-tray__footer">
          <strong role="status">{props.status}</strong>
        </footer>
      )}
    </aside>
  );
}

function TrayVisual(props: {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  asset: AssetSummary;
}) {
  const [failed, setFailed] = useState(false);
  if (!failed && props.asset.availability === "present" && props.asset.previewKind === "image") {
    return <img alt="" aria-hidden src={props.bridge.assetResourceUrl({ sessionId: props.sessionId, assetId: props.asset.assetId, profile: "grid_standard" })} onError={() => setFailed(true)} />;
  }
  return <span className="selection-chip__placeholder" aria-hidden>{props.asset.extension?.toUpperCase() ?? props.asset.mediaFamily.toUpperCase()}</span>;
}
