import {
  useEffect,
  useRef,
  useState,
  type RefCallback,
  type UIEvent,
} from "react";
import type {
  AssetSummary,
  ReferenceWorkspaceBridge,
  ReviewState,
} from "@pitchdog/reference-bridge";
import { handleDialogKey } from "./dialog-keys";
import { safeErrorMessage } from "./safe-errors";

export interface ScrollMetrics {
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

export interface NormalizedPan {
  x: number;
  y: number;
}

export function normalizedPan(metrics: ScrollMetrics): NormalizedPan {
  const horizontal = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  const vertical = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  return {
    x: horizontal === 0 ? 0 : clamp(metrics.scrollLeft / horizontal),
    y: vertical === 0 ? 0 : clamp(metrics.scrollTop / vertical),
  };
}

export function panOffsets(
  pan: NormalizedPan,
  metrics: Pick<ScrollMetrics, "scrollWidth" | "scrollHeight" | "clientWidth" | "clientHeight">,
): { left: number; top: number } {
  return {
    left: clamp(pan.x) * Math.max(0, metrics.scrollWidth - metrics.clientWidth),
    top: clamp(pan.y) * Math.max(0, metrics.scrollHeight - metrics.clientHeight),
  };
}

export function CompareBoard(props: {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  assets: readonly AssetSummary[];
  totalShortlisted: number;
  onReview(asset: AssetSummary, reviewState: ReviewState): Promise<boolean>;
  onRemove(assetId: string): void;
  onClose(): void;
  onError(message: string): void;
}) {
  const [zoom, setZoom] = useState<"fit" | 1 | 2>("fit");
  const [syncPan, setSyncPan] = useState(true);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const stages = useRef(new Map<string, HTMLDivElement>());
  const synchronizing = useRef(false);
  const busy = busyAssetId !== null;

  useEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    for (const stage of stages.current.values()) {
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
    }
  }, [zoom]);

  const registerStage = (assetId: string): RefCallback<HTMLDivElement> => (stage) => {
    if (stage) stages.current.set(assetId, stage);
    else stages.current.delete(assetId);
  };

  const synchronizePan = (assetId: string, source: HTMLDivElement) => {
    if (!syncPan || zoom === "fit" || synchronizing.current) return;
    const pan = normalizedPan(source);
    synchronizing.current = true;
    for (const [targetId, target] of stages.current) {
      if (targetId === assetId) continue;
      const offsets = panOffsets(pan, target);
      target.scrollLeft = offsets.left;
      target.scrollTop = offsets.top;
    }
    requestAnimationFrame(() => { synchronizing.current = false; });
  };

  const review = async (asset: AssetSummary, reviewState: ReviewState) => {
    setBusyAssetId(asset.assetId);
    setStatus(null);
    try {
      const updated = await props.onReview(asset, reviewState);
      if (updated) setStatus(`${asset.displayName} marked ${reviewState}.`);
    } finally {
      setBusyAssetId(null);
    }
  };

  const nativeAction = async (
    asset: AssetSummary,
    action: "open" | "reveal" | "copy",
  ) => {
    setBusyAssetId(asset.assetId);
    setStatus(null);
    try {
      if (action === "open") await props.bridge.openLocation(props.sessionId, asset.locationId);
      else if (action === "reveal") await props.bridge.revealLocation(props.sessionId, asset.locationId);
      else await props.bridge.copyLocationPath(props.sessionId, asset.locationId);
      const verb = action === "open" ? "Opened" : action === "reveal" ? "Revealed" : "Copied the path for";
      setStatus(`${verb} ${asset.displayName}.`);
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
            <p>Showing the first {props.assets.length} of {props.totalShortlisted} shortlisted Assets. Reorder the Shortlist to change these slots.</p>
          )}
          {status && <p className="compare-board__status" role="status">{status}</p>}
        </div>
        <div className="compare-board__controls">
          <div className="compare-board__zoom" role="group" aria-label="Compare zoom">
            <button aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>Fit</button>
            <button className="button--secondary" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>100%</button>
            <button className="button--secondary" aria-pressed={zoom === 2} onClick={() => setZoom(2)}>200%</button>
          </div>
          <button
            className="button--secondary"
            aria-pressed={syncPan}
            disabled={zoom === "fit"}
            title={zoom === "fit" ? "Choose 100% or 200% to pan" : "Mirror normalized pan across image cards"}
            onClick={() => setSyncPan((current) => !current)}
          >
            Sync pan
          </button>
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
                  <p title={asset.relativeDisplayPath}>{asset.category} · {asset.extension ? `.${asset.extension}` : asset.mediaFamily} · {formatBytes(asset.byteSize)}</p>
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
                stageRef={registerStage(asset.assetId)}
                onScroll={(stage) => synchronizePan(asset.assetId, stage)}
              />

              <CompareContext asset={asset} />

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
                  <button className="button--secondary" disabled={!sourceAvailable || busy} onClick={() => void nativeAction(asset, "copy")}>Copy path</button>
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
  stageRef: RefCallback<HTMLDivElement>;
  onScroll(stage: HTMLDivElement): void;
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

  const onScroll = (event: UIEvent<HTMLDivElement>) => props.onScroll(event.currentTarget);
  return (
    <div
      className={`compare-card__stage ${props.zoom === "fit" ? "compare-card__stage--fit" : ""}`}
      aria-busy={state === "loading"}
      aria-label={`Visual comparison for ${props.asset.displayName}`}
      ref={props.stageRef}
      onScroll={onScroll}
    >
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

function CompareContext({ asset }: { asset: AssetSummary }) {
  const tags = asset.tags.slice(0, 4);
  const usedIn = asset.usedIn.slice(0, 3);
  return (
    <div className="compare-card__context">
      <span className={`compare-card__review-state compare-card__review-state--${asset.reviewState}`}>{asset.reviewState}</span>
      {tags.map((tag) => <span className="compare-card__tag" key={`tag-${tag}`}>#{tag}</span>)}
      {asset.tags.length > tags.length && <span>+{asset.tags.length - tags.length} tags</span>}
      {usedIn.map((usage) => <span className="compare-card__usage" key={`usage-${usage}`}>Used in {usage}</span>)}
      {asset.usedIn.length > usedIn.length && <span>+{asset.usedIn.length - usedIn.length} uses</span>}
      {tags.length === 0 && usedIn.length === 0 && <span className="muted">No tags or usage notes yet.</span>}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
