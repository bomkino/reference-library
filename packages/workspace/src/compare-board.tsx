import { useEffect, useRef, useState } from "react";
import type {
  AssetSummary,
  ReferenceWorkspaceBridge,
  ReviewState,
} from "@pitchdog/reference-bridge";
import { handleDialogKey } from "./dialog-keys";
import { safeErrorMessage } from "./safe-errors";

export function CompareBoard(props: {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  assets: readonly AssetSummary[];
  totalShortlisted: number;
  onReview(asset: AssetSummary, reviewState: ReviewState): Promise<void>;
  onRemove(assetId: string): void;
  onClose(): void;
  onError(message: string): void;
}) {
  const [zoom, setZoom] = useState<"fit" | 1 | 2>("fit");
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const busy = busyAssetId !== null;

  useEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, []);

  const review = async (asset: AssetSummary, reviewState: ReviewState) => {
    setBusyAssetId(asset.assetId);
    try {
      await props.onReview(asset, reviewState);
    } finally {
      setBusyAssetId(null);
    }
  };

  const nativeAction = async (asset: AssetSummary, action: "open" | "reveal") => {
    setBusyAssetId(asset.assetId);
    try {
      if (action === "open") await props.bridge.openLocation(props.sessionId, asset.locationId);
      else await props.bridge.revealLocation(props.sessionId, asset.locationId);
    } catch (reason) {
      props.onError(safeErrorMessage(reason, "The original file action failed."));
    } finally {
      setBusyAssetId(null);
    }
  };

  return (
    <section
      className="compare-board"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-title"
      aria-busy={busy}
      onKeyDown={(event) => {
        if (busy && event.key === "Escape") {
          event.preventDefault();
          return;
        }
        handleDialogKey(event, props.onClose);
      }}
    >
      <header className="compare-board__header">
        <div>
          <p className="eyebrow">Compare Board</p>
          <h2 id="compare-title">{props.assets.length} references, side by side.</h2>
          {props.totalShortlisted > props.assets.length && (
            <p>Showing the first {props.assets.length} of {props.totalShortlisted} shortlisted Assets.</p>
          )}
        </div>
        <div className="compare-board__controls">
          <div className="compare-board__zoom" role="group" aria-label="Compare zoom">
            <button aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>Fit</button>
            <button className="button--secondary" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>100%</button>
            <button className="button--secondary" aria-pressed={zoom === 2} onClick={() => setZoom(2)}>200%</button>
          </div>
          <button ref={close} className="button--secondary" disabled={busy} onClick={props.onClose}>Close</button>
        </div>
      </header>

      <div className="compare-board__grid" data-count={props.assets.length}>
        {props.assets.map((asset, index) => {
          const sourceAvailable = asset.availability === "present" || asset.availability === "unsupported";
          const active = busyAssetId === asset.assetId;
          return (
            <article className="compare-card" key={asset.assetId} aria-busy={active}>
              <header className="compare-card__header">
                <div>
                  <span className="compare-card__number">{index + 1}</span>
                  <h3>{asset.displayName}</h3>
                  <p>{asset.category} · {asset.extension ? `.${asset.extension}` : asset.mediaFamily} · {formatBytes(asset.byteSize)}</p>
                </div>
                <button
                  className="compare-card__remove button--quiet"
                  aria-label={`Remove ${asset.displayName} from comparison`}
                  disabled={busy}
                  onClick={() => props.onRemove(asset.assetId)}
                >
                  Remove
                </button>
              </header>

              <CompareVisual
                bridge={props.bridge}
                sessionId={props.sessionId}
                asset={asset}
                zoom={zoom}
              />

              <footer className="compare-card__footer">
                <div className="compare-card__review" role="group" aria-label={`Review ${asset.displayName}`}>
                  {(["keep", "maybe", "reject"] as ReviewState[]).map((reviewState) => (
                    <button
                      className="button--secondary"
                      aria-pressed={asset.reviewState === reviewState}
                      disabled={busy}
                      key={reviewState}
                      onClick={() => void review(asset, reviewState)}
                    >
                      {reviewState[0]?.toUpperCase()}{reviewState.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="compare-card__native-actions">
                  <button disabled={!sourceAvailable || busy} onClick={() => void nativeAction(asset, "open")}>Open</button>
                  <button className="button--secondary" disabled={!sourceAvailable || busy} onClick={() => void nativeAction(asset, "reveal")}>Reveal</button>
                </div>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CompareVisual(props: {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  asset: AssetSummary;
  zoom: "fit" | 1 | 2;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const imageAvailable = props.asset.availability === "present" && props.asset.previewKind === "image";
  if (!imageAvailable) {
    return (
      <div className="compare-card__placeholder">
        <strong>{props.asset.extension?.toUpperCase() ?? props.asset.mediaFamily.toUpperCase()}</strong>
        <span>{props.asset.previewKind === "none" ? "Catalogue only" : `${props.asset.previewKind} preview opens individually`}</span>
      </div>
    );
  }

  return (
    <div className={`compare-card__stage ${props.zoom === "fit" ? "compare-card__stage--fit" : ""}`} aria-busy={state === "loading"}>
      {state === "loading" && <span role="status">Loading…</span>}
      {state === "failed" && <span role="alert">Preview unavailable.</span>}
      <img
        alt={props.asset.displayName}
        draggable={false}
        hidden={state === "failed"}
        src={props.bridge.assetResourceUrl({ sessionId: props.sessionId, assetId: props.asset.assetId, profile: "preview" })}
        style={props.zoom === "fit" ? undefined : { width: `${props.zoom * 100}%` }}
        onLoad={() => setState("ready")}
        onError={() => setState("failed")}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
