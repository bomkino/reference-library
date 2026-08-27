import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssetSummary } from "@pitchdog/reference-bridge";
import { handleDialogKey } from "./dialog-keys";

const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4] as const;

export function AssetPreview(props: { asset: AssetSummary; source: string; initialZoom: number; onZoomChange(value: number): void; onClose(): void }) {
  const [resourceState, setResourceState] = useState<"loading" | "ready" | "failed">("loading");
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(props.initialZoom);
  const close = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const priorViewport = useRef<{ left: number; top: number; width: number; height: number; contentWidth: number; contentHeight: number } | null>(null);
  const unavailable = props.asset.availability !== "present";

  useEffect(() => {
    setResourceState("loading");
  }, [props.asset.assetId, props.source]);

  useEffect(() => {
    close.current?.focus();
  }, [props.onClose]);

  const stepZoom = (direction: -1 | 1) => {
    const viewport = stage.current;
    if (viewport) priorViewport.current = { left: viewport.scrollLeft, top: viewport.scrollTop, width: viewport.clientWidth, height: viewport.clientHeight, contentWidth: viewport.scrollWidth, contentHeight: viewport.scrollHeight };
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

  return (
    <div className="preview" role="dialog" aria-modal="true" aria-label={`Preview ${props.asset.displayName}`} onKeyDown={(event) => handleDialogKey(event, props.onClose)}>
      <div className="preview__toolbar">
        <button ref={close} onClick={props.onClose}>Close Preview</button>
        <button aria-pressed={fit} onClick={() => setFit(true)}>Fit</button>
        <button aria-label="Zoom out" disabled={!fit && zoom === ZOOM_LEVELS[0]} onClick={() => stepZoom(-1)}>−</button>
        <output aria-live="polite">{fit ? "Fit" : `${Math.round(zoom * 100)}%`}</output>
        <button aria-label="Zoom in" disabled={!fit && zoom === ZOOM_LEVELS.at(-1)} onClick={() => stepZoom(1)}>+</button>
      </div>
      {resourceState === "failed" || unavailable ? (
        <div className="preview__error" role="alert"><strong>Preview unavailable</strong><span>{unavailable ? `The source is ${props.asset.availability}. Its curation remains catalogued.` : "The original remains catalogued. Its source was not changed."}</span></div>
      ) : (
        <div ref={stage} className={fit ? "preview__stage preview__stage--fit" : "preview__stage"} aria-busy={resourceState === "loading"}>
          {resourceState === "loading" && <p className="preview__loading" role="status">Loading Preview…</p>}
          <img className={resourceState === "loading" ? "preview__image preview__image--pending" : "preview__image"} alt={props.asset.displayName} src={props.source} style={fit ? undefined : { width: `${zoom * 100}%` }} onLoad={() => setResourceState("ready")} onError={() => setResourceState("failed")} />
        </div>
      )}
    </div>
  );
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
