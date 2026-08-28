import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssetSummary, ReferenceWorkspaceBridge } from "@pitchdog/reference-bridge";
import { handleDialogKey } from "./dialog-keys";
import { safeErrorMessage } from "./safe-errors";

const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4] as const;

export function AssetPreview(props: {
  asset: AssetSummary;
  source: string;
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  initialZoom: number;
  onZoomChange(value: number): void;
  onClose(): void;
  onError(message: string): void;
}) {
  const [resourceState, setResourceState] = useState<"loading" | "ready" | "failed">("loading");
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(props.initialZoom);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const priorViewport = useRef<{ left: number; top: number; width: number; height: number; contentWidth: number; contentHeight: number } | null>(null);
  const sourceAvailable = props.asset.availability === "present" || props.asset.availability === "unsupported";
  const previewAvailable = props.asset.availability === "present" && props.asset.previewKind !== "none";
  const imagePreview = props.asset.previewKind === "image";

  useEffect(() => {
    setResourceState(previewAvailable ? "loading" : "failed");
    setActionStatus(null);
  }, [previewAvailable, props.asset.assetId, props.source]);

  useEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, [props.asset.assetId]);

  const stepZoom = (direction: -1 | 1) => {
    const viewport = stage.current;
    if (viewport) priorViewport.current = {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      contentWidth: viewport.scrollWidth,
      contentHeight: viewport.scrollHeight,
    };
    const current = ZOOM_LEVELS.indexOf(zoom as (typeof ZOOM_LEVELS)[number]);
    const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, current + direction));
    setFit(false);
    setZoom(ZOOM_LEVELS[next]!);
    props.onZoomChange(ZOOM_LEVELS[next]!);
  };

  useLayoutEffect(() => {
    const viewport = stage.current;
    const prior = priorViewport.current;
    if (!viewport || !prior || fit) return;
    priorViewport.current = null;
    viewport.scrollLeft = focalScrollOffset(prior.left, prior.width, prior.contentWidth, viewport.scrollWidth);
    viewport.scrollTop = focalScrollOffset(prior.top, prior.height, prior.contentHeight, viewport.scrollHeight);
  }, [fit, zoom]);

  const nativeAction = async (action: "open" | "reveal" | "copy") => {
    try {
      if (action === "open") await props.bridge.openLocation(props.sessionId, props.asset.locationId);
      else if (action === "reveal") await props.bridge.revealLocation(props.sessionId, props.asset.locationId);
      else await props.bridge.copyLocationPath(props.sessionId, props.asset.locationId);
      if (action === "copy") setActionStatus("Original path copied.");
    } catch (reason) {
      props.onError(safeErrorMessage(reason, "The original file action failed."));
    }
  };

  return (
    <div className="preview" role="dialog" aria-modal="true" aria-labelledby="preview-title" onKeyDown={(event) => handleDialogKey(event, props.onClose)}>
      <header className="preview__header">
        <div>
          <p className="eyebrow">{props.asset.category} · {props.asset.extension ? `.${props.asset.extension}` : props.asset.mediaFamily}</p>
          <h2 id="preview-title">{props.asset.displayName}</h2>
          <p className="preview__subhead">{formatBytes(props.asset.byteSize)} · {props.asset.reviewState}</p>
        </div>
        <div className="preview__header-actions">
          <button disabled={!sourceAvailable} onClick={() => void nativeAction("open")}>Open Original</button>
          <button className="button--secondary" disabled={!sourceAvailable} onClick={() => void nativeAction("reveal")}>Reveal</button>
          <button className="button--secondary" disabled={!sourceAvailable} onClick={() => void nativeAction("copy")}>Copy Path</button>
          <button ref={close} className="button--secondary" onClick={props.onClose}>Close</button>
        </div>
      </header>

      {imagePreview && previewAvailable && (
        <div className="preview__toolbar" aria-label="Preview zoom">
          <button aria-pressed={fit} onClick={() => setFit(true)}>Fit</button>
          <button aria-label="Zoom out" disabled={!fit && zoom === ZOOM_LEVELS[0]} onClick={() => stepZoom(-1)}>−</button>
          <output aria-live="polite">{fit ? "Fit" : `${Math.round(zoom * 100)}%`}</output>
          <button aria-label="Zoom in" disabled={!fit && zoom === ZOOM_LEVELS.at(-1)} onClick={() => stepZoom(1)}>+</button>
        </div>
      )}

      {actionStatus && <p className="preview__action-status" role="status">{actionStatus}</p>}

      {!previewAvailable ? (
        <PreviewUnavailable asset={props.asset} />
      ) : (
        <div
          ref={stage}
          className={imagePreview && fit ? "preview__stage preview__stage--fit" : "preview__stage"}
          aria-busy={resourceState === "loading"}
        >
          {resourceState === "loading" && <p className="preview__loading" role="status">Loading preview…</p>}
          <PreviewMedia
            asset={props.asset}
            source={props.source}
            fit={fit}
            zoom={zoom}
            state={resourceState}
            onReady={() => setResourceState("ready")}
            onFailure={() => setResourceState("failed")}
          />
          {resourceState === "failed" && <PreviewUnavailable asset={props.asset} failed />}
        </div>
      )}
    </div>
  );
}

function PreviewMedia(props: {
  asset: AssetSummary;
  source: string;
  fit: boolean;
  zoom: number;
  state: "loading" | "ready" | "failed";
  onReady(): void;
  onFailure(): void;
}) {
  const hidden = props.state === "failed";
  switch (props.asset.previewKind) {
    case "image":
      return (
        <img
          className={props.state === "loading" ? "preview__image preview__image--pending" : "preview__image"}
          alt={props.asset.displayName}
          src={props.source}
          hidden={hidden}
          style={props.fit ? undefined : { width: `${props.zoom * 100}%` }}
          onLoad={props.onReady}
          onError={props.onFailure}
        />
      );
    case "video":
      return <video className="preview__media" controls playsInline preload="metadata" src={props.source} hidden={hidden} onLoadedMetadata={props.onReady} onError={props.onFailure} />;
    case "audio":
      return (
        <div className="preview__audio">
          <div className="preview__audio-mark" aria-hidden>{props.asset.extension?.toUpperCase() ?? "AUDIO"}</div>
          <audio controls preload="metadata" src={props.source} hidden={hidden} onLoadedMetadata={props.onReady} onError={props.onFailure} />
        </div>
      );
    case "pdf":
      return <iframe className="preview__document" title={`PDF preview: ${props.asset.displayName}`} src={props.source} hidden={hidden} onLoad={props.onReady} onError={props.onFailure} />;
    case "font":
      return <FontPreview name={props.asset.displayName} source={props.source} onReady={props.onReady} onFailure={props.onFailure} />;
    case "text":
      return <iframe className="preview__document preview__document--text" title={`Text preview: ${props.asset.displayName}`} src={props.source} hidden={hidden} onLoad={props.onReady} onError={props.onFailure} />;
    default:
      return null;
  }
}

function FontPreview(props: { name: string; source: string; onReady(): void; onFailure(): void }) {
  const [family] = useState(() => `ReferencePreview-${crypto.randomUUID()}`);
  useEffect(() => {
    let active = true;
    const face = new FontFace(family, `url(${JSON.stringify(props.source)})`);
    void face.load().then((loaded) => {
      if (!active) return;
      document.fonts.add(loaded);
      props.onReady();
    }).catch(() => { if (active) props.onFailure(); });
    return () => {
      active = false;
      document.fonts.forEach((loaded) => { if (loaded.family === family) document.fonts.delete(loaded); });
    };
  }, [family, props.source]);
  return (
    <div className="preview__font" style={{ fontFamily: `'${family}', sans-serif` }}>
      <p className="preview__font-hero">The quick brown fox jumps over the lazy dog.</p>
      <p className="preview__font-alphabet">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br />abcdefghijklmnopqrstuvwxyz<br />0123456789 !?&amp;@</p>
      <p className="preview__font-name">{props.name}</p>
    </div>
  );
}

function PreviewUnavailable({ asset, failed = false }: { asset: AssetSummary; failed?: boolean }) {
  const sourceProblem = asset.availability !== "present" && asset.availability !== "unsupported";
  return (
    <div className="preview__error" role="alert">
      <strong>{failed ? "Preview could not be rendered" : asset.previewKind === "none" ? "Catalogue-only format" : "Preview unavailable"}</strong>
      <span>
        {sourceProblem
          ? `The source is ${availabilityLabel(asset.availability)}. Its curation remains catalogued.`
          : "Open the original in its native application, reveal it in Finder or Dolphin, or copy its path."}
      </span>
    </div>
  );
}

function availabilityLabel(value: string): string {
  const labels: Record<string, string> = {
    needs_permission: "waiting for permission",
    offline_volume: "on an offline volume",
    unreadable: "catalogued without an in-app preview",
    unavailable: "unavailable",
    missing: "missing",
    unsupported: "catalogued without an in-app preview",
  };
  return labels[value] ?? "not available";
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function focalScrollOffset(
  priorOffset: number,
  viewportSize: number,
  priorContentSize: number,
  nextContentSize: number,
): number {
  if (priorContentSize <= 0 || nextContentSize <= viewportSize) return 0;
  const focalRatio = (priorOffset + viewportSize / 2) / priorContentSize;
  return Math.max(0, Math.min(nextContentSize - viewportSize, focalRatio * nextContentSize - viewportSize / 2));
}
