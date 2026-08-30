import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { ArrowLeft, ArrowRight, ArrowSquareOut, Copy, FolderOpen, X } from "@phosphor-icons/react";
import type {
  AssetSummary,
  ReferenceWorkspaceBridge,
  ReviewState,
} from "@pitchdog/reference-bridge";
import { handleDialogKey } from "./dialog-keys";
import { safeErrorMessage } from "./safe-errors";
import { UiIcon } from "./ui-icon";

type CompareZoom = "fit" | "fill" | 1 | 2;

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
    x: horizontal === 0 ? 0.5 : clamp(metrics.scrollLeft / horizontal),
    y: vertical === 0 ? 0.5 : clamp(metrics.scrollTop / vertical),
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
  onMove(assetId: string, direction: -1 | 1): void;
  onRemove(assetId: string): void;
  onClose(): void;
  onError(message: string): void;
}) {
  const [zoom, setZoom] = useState<CompareZoom>("fit");
  const [syncPan, setSyncPan] = useState(true);
  const [pan, setPan] = useState<NormalizedPan>({ x: 0.5, y: 0.5 });
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const busy = busyAssetId !== null;

  useEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, []);

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

  const nativeAction = async (asset: AssetSummary, action: "open" | "reveal" | "copy") => {
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
        <div className="compare-board__identity">
          <p className="eyebrow">Compare</p>
          <h2 id="compare-title">Judge the frame, not the filename.</h2>
          <p>
            {props.assets.length} references side by side
            {props.totalShortlisted > props.assets.length ? ` · first ${props.assets.length} of ${props.totalShortlisted} shortlisted` : ""}
          </p>
          {status && <p className="compare-board__status" role="status">{status}</p>}
        </div>
        <div className="compare-board__controls">
          <div className="compare-board__zoom" role="group" aria-label="Compare framing">
            <button className="button--secondary" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>Fit</button>
            <button className="button--secondary" aria-pressed={zoom === "fill"} onClick={() => setZoom("fill")}>Fill</button>
            <button className="button--secondary" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>100%</button>
            <button className="button--secondary" aria-pressed={zoom === 2} onClick={() => setZoom(2)}>200%</button>
          </div>
          <label className="toggle-control compare-board__sync">
            <input
              type="checkbox"
              checked={syncPan}
              disabled={zoom === "fit" || zoom === "fill"}
              onChange={(event) => setSyncPan(event.target.checked)}
            />
            <span>Sync pan</span>
          </label>
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
                <div className="compare-card__identity">
                  <span className="compare-card__number">{index + 1}</span>
                  <span>
                    <h3>{asset.displayName}</h3>
                    <p>{asset.category} · {asset.extension ? `.${asset.extension}` : asset.mediaFamily} · {formatBytes(asset.byteSize)}</p>
                  </span>
                </div>
                <div className="compare-card__order" role="group" aria-label={`Reorder ${asset.displayName}`}>
                  <button className="button--quiet" aria-label={`Move ${asset.displayName} earlier`} title={`Move ${asset.displayName} earlier`} disabled={busy || index === 0} onClick={() => props.onMove(asset.assetId, -1)}><UiIcon icon={ArrowLeft} /></button>
                  <button className="button--quiet" aria-label={`Move ${asset.displayName} later`} title={`Move ${asset.displayName} later`} disabled={busy || index === props.assets.length - 1} onClick={() => props.onMove(asset.assetId, 1)}><UiIcon icon={ArrowRight} /></button>
                  <button className="button--quiet" aria-label={`Remove ${asset.displayName} from comparison`} title={`Remove ${asset.displayName} from comparison`} disabled={busy} onClick={() => props.onRemove(asset.assetId)}><UiIcon icon={X} /></button>
                </div>
              </header>

              <CompareVisual
                bridge={props.bridge}
                sessionId={props.sessionId}
                asset={asset}
                zoom={zoom}
                pan={pan}
                syncPan={syncPan}
                onPan={setPan}
              />

              <div className="compare-card__context">
                <span className={`review-pill review-pill--${asset.reviewState}`}>{asset.reviewState}</span>
                {asset.tags.slice(0, 3).map((tag) => <span className="metadata-pill" key={tag}>#{tag}</span>)}
                {asset.usedIn.slice(0, 2).map((value) => <span className="metadata-pill" key={value}>Used in {value}</span>)}
              </div>

              <footer className="compare-card__footer">
                <div className="compare-card__review" role="group" aria-label={`Review ${asset.displayName}`}>
                  {(["keep", "maybe", "reject"] as ReviewState[]).map((reviewState) => (
                    <button
                      className={`review-choice review-choice--${reviewState}`}
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
                  <button disabled={!sourceAvailable || busy} onClick={() => void nativeAction(asset, "open")}><UiIcon icon={ArrowSquareOut} />{" "}Open</button>
                  <button className="button--secondary" disabled={!sourceAvailable || busy} onClick={() => void nativeAction(asset, "reveal")}><UiIcon icon={FolderOpen} />{" "}Reveal</button>
                  <button className="button--quiet" disabled={!sourceAvailable || busy} onClick={() => void nativeAction(asset, "copy")}><UiIcon icon={Copy} />{" "}Copy path</button>
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
  zoom: CompareZoom;
  pan: NormalizedPan;
  syncPan: boolean;
  onPan(pan: NormalizedPan): void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const stage = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const imageAvailable = props.asset.availability === "present" && props.asset.previewKind === "image";

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || !props.syncPan || typeof props.zoom !== "number") return;
    const offsets = panOffsets(props.pan, element);
    programmatic.current = true;
    element.scrollLeft = offsets.left;
    element.scrollTop = offsets.top;
    requestAnimationFrame(() => { programmatic.current = false; });
  }, [props.pan, props.syncPan, props.zoom, state]);

  if (!imageAvailable) {
    return (
      <div className="compare-card__placeholder">
        <strong>{props.asset.extension?.toUpperCase() ?? props.asset.mediaFamily.toUpperCase()}</strong>
        <span>{props.asset.previewKind === "none" ? "Catalogue only · open the original to inspect" : `${props.asset.previewKind} preview opens individually`}</span>
      </div>
    );
  }

  const framingClass = props.zoom === "fit"
    ? " compare-card__stage--fit"
    : props.zoom === "fill"
      ? " compare-card__stage--fill"
      : "";

  return (
    <div
      className={`compare-card__stage${framingClass}`}
      ref={stage}
      aria-busy={state === "loading"}
      onScroll={(event: UIEvent<HTMLDivElement>) => {
        if (!props.syncPan || typeof props.zoom !== "number" || programmatic.current) return;
        props.onPan(normalizedPan(event.currentTarget));
      }}
    >
      {state === "loading" && <span role="status">Loading reference…</span>}
      {state === "failed" && <span role="alert">Preview unavailable. Open the original instead.</span>}
      <img
        alt={props.asset.displayName}
        draggable={false}
        hidden={state === "failed"}
        src={props.bridge.assetResourceUrl({ sessionId: props.sessionId, assetId: props.asset.assetId, profile: "preview" })}
        style={typeof props.zoom === "number" ? { width: `${props.zoom * 100}%` } : undefined}
        onLoad={() => setState("ready")}
        onError={() => setState("failed")}
      />
    </div>
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
