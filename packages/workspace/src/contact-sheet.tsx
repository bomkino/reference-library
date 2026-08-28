import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  AssetSummary,
  AssetViewMode,
  ReferenceWorkspaceBridge,
} from "@pitchdog/reference-bridge";
import {
  moveSelectionIndex,
  scrollTopForSelection,
  type NavigationKey,
} from "./selection";
import { computeVirtualWindow } from "./virtual-window";

interface ContactSheetProps {
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  total: number;
  items: ReadonlyMap<number, AssetSummary>;
  thumbnailSize: number;
  viewMode: AssetViewMode;
  multiThumbnailPreviews: boolean;
  selectedAssetId: string | null;
  ensureWindow(start: number, end: number): void;
  onSelect(asset: AssetSummary): void;
  onPreview(asset: AssetSummary): void;
  onOpen(asset: AssetSummary): void;
}

export function ContactSheet(props: ContactSheetProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingFocusIndex = useRef<number | null>(null);
  const restoreGridFocus = useRef(false);
  const [geometry, setGeometry] = useState({ width: 900, height: 600, scrollTop: 0 });
  const layout = contactSheetLayout(props.viewMode, props.thumbnailSize, geometry.width);
  const virtual = useMemo(
    () => computeVirtualWindow({
      itemCount: props.total,
      columns: layout.columns,
      rowHeight: layout.cardHeight + layout.gap,
      viewportHeight: geometry.height,
      scrollTop: geometry.scrollTop,
      overscanRows: 3,
    }),
    [geometry.height, geometry.scrollTop, layout, props.total],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maximumScrollTop = Math.max(0, virtual.totalHeight - geometry.height);
    if (geometry.scrollTop <= maximumScrollTop) return;
    viewport.scrollTop = maximumScrollTop;
    setGeometry((current) => ({ ...current, scrollTop: maximumScrollTop }));
  }, [geometry.height, geometry.scrollTop, virtual.totalHeight]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setGeometry((current) => ({
      ...current,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    props.ensureWindow(virtual.startIndex, virtual.endIndexExclusive);
  }, [props.ensureWindow, virtual.startIndex, virtual.endIndexExclusive]);

  useEffect(() => {
    const index = pendingFocusIndex.current;
    if (index === null) return;
    const asset = props.items.get(index);
    if (!asset) return;
    pendingFocusIndex.current = null;
    props.onSelect(asset);
    requestAnimationFrame(() => {
      viewportRef.current
        ?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`)
        ?.focus({ preventScroll: true });
    });
  }, [props.items, props.onSelect, virtual.startIndex, virtual.endIndexExclusive]);

  const indices = useMemo(
    () => Array.from({ length: virtual.renderedCount }, (_, index) => virtual.startIndex + index),
    [virtual],
  );
  const selectedVisibleIndex = indices.find((index) => props.items.get(index)?.assetId === props.selectedAssetId);
  const firstVisibleLoadedIndex = indices.find((index) => props.items.has(index));
  const rovingIndex = selectedVisibleIndex ?? firstVisibleLoadedIndex ?? null;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !restoreGridFocus.current) return;
    const active = document.activeElement;
    if (active !== viewport && active instanceof Node && viewport.contains(active)) return;
    const target = rovingIndex === null
      ? null
      : viewport.querySelector<HTMLButtonElement>(`[data-index="${rovingIndex}"]`);
    (target ?? viewport).focus({ preventScroll: true });
  }, [props.items, rovingIndex]);

  const handleKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!isNavigationKey(event.key)) return;
    event.preventDefault();
    const nextIndex = moveSelectionIndex(index, event.key, layout.columns, props.total);
    pendingFocusIndex.current = nextIndex;
    const nextAsset = props.items.get(nextIndex);
    if (nextAsset) {
      pendingFocusIndex.current = null;
      props.onSelect(nextAsset);
    }
    props.ensureWindow(nextIndex, nextIndex + 1);
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTop = scrollTopForSelection(
        nextIndex,
        layout.columns,
        layout.cardHeight + layout.gap,
        geometry.height,
        viewport.scrollTop,
      );
    }
    requestAnimationFrame(() => {
      viewportRef.current?.querySelector<HTMLButtonElement>(`[data-index="${nextIndex}"]`)?.focus({ preventScroll: true });
    });
  };

  return (
    <div
      className={`contact-sheet contact-sheet--${props.viewMode}`}
      ref={viewportRef}
      role="grid"
      tabIndex={-1}
      aria-label={`Editorial Contact Sheet, ${props.total} assets, ${props.viewMode} view`}
      aria-rowcount={Math.ceil(props.total / layout.columns)}
      aria-colcount={layout.columns}
      onScroll={(event) => setGeometry((current) => ({ ...current, scrollTop: event.currentTarget.scrollTop }))}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) restoreGridFocus.current = false;
      }}
    >
      <div className="contact-sheet__canvas" style={{ height: virtual.totalHeight }}>
        <div
          className="contact-sheet__window"
          style={{
            top: virtual.offsetTop,
            gridTemplateColumns: layout.template,
            gridAutoRows: `${layout.cardHeight}px`,
            gap: layout.gap,
          }}
        >
          {indices.map((index) => {
            const asset = props.items.get(index);
            if (!asset) return <div className="asset-card asset-card--loading" key={index} aria-hidden />;
            const selected = props.selectedAssetId === asset.assetId;
            const open = () => asset.availability === "present" && asset.previewKind !== "none"
              ? props.onPreview(asset)
              : props.onOpen(asset);
            return (
              <button
                className={`asset-card asset-card--${props.viewMode}`}
                data-index={index}
                data-asset-id={asset.assetId}
                key={asset.assetId}
                role="gridcell"
                aria-rowindex={Math.floor(index / layout.columns) + 1}
                aria-colindex={(index % layout.columns) + 1}
                aria-selected={selected}
                aria-label={`${asset.displayName}, ${asset.category}, ${asset.mediaFamily}, ${asset.reviewState}, ${asset.availability}`}
                tabIndex={index === rovingIndex ? 0 : -1}
                onFocus={() => { restoreGridFocus.current = true; }}
                onClick={() => props.onSelect(asset)}
                onDoubleClick={open}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open();
                  handleKey(event, index);
                }}
              >
                <AssetVisual
                  asset={asset}
                  bridge={props.bridge}
                  sessionId={props.sessionId}
                  multi={props.multiThumbnailPreviews && props.viewMode !== "list"}
                />
                <span className="asset-card__copy">
                  <span className="asset-card__name" title={asset.displayName}>{asset.displayName}</span>
                  <span className="asset-card__meta">
                    <span>{asset.category}</span>
                    <span>{asset.extension ? `.${asset.extension}` : asset.mediaFamily}</span>
                    <span>{formatBytes(asset.byteSize)}</span>
                  </span>
                  <span className="asset-card__tokens">
                    {asset.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}
                  </span>
                </span>
                <span className={`asset-card__state asset-card__state--${asset.reviewState}`}>{asset.reviewState}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AssetVisual(props: {
  asset: AssetSummary;
  bridge: ReferenceWorkspaceBridge;
  sessionId: string;
  multi: boolean;
}) {
  const mainGridPreview = isGridPreviewable(props.asset);
  const ids = [
    ...(mainGridPreview ? [props.asset.assetId] : []),
    ...(props.multi ? props.asset.previewAssetIds : []),
  ].slice(0, props.multi ? 4 : 1);

  return (
    <span className={`asset-card__image-frame ${ids.length > 1 ? "asset-card__image-frame--mosaic" : ""}`}>
      {ids.length > 0 ? ids.map((assetId) => (
        <AssetThumbnail
          key={assetId}
          source={props.bridge.assetResourceUrl({
            sessionId: props.sessionId,
            assetId,
            profile: "grid_standard",
          })}
        />
      )) : (
        <AssetPlaceholder asset={props.asset} />
      )}
      {props.multi && props.asset.previewAssetIds.length > Math.max(0, ids.length - Number(mainGridPreview)) && (
        <span className="asset-card__more">+{props.asset.previewAssetIds.length - Math.max(0, ids.length - Number(mainGridPreview))}</span>
      )}
    </span>
  );
}

function AssetThumbnail({ source }: { source: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  return (
    <span className="asset-card__thumb">
      {state === "loading" && <span className="asset-card__resource-state">Loading…</span>}
      {state === "error" && <span className="asset-card__resource-state">No preview</span>}
      <img
        alt=""
        aria-hidden
        draggable={false}
        loading="lazy"
        src={source}
        hidden={state === "error"}
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
      />
    </span>
  );
}

function AssetPlaceholder({ asset }: { asset: AssetSummary }) {
  const label = asset.availability === "present"
    ? asset.previewKind === "none" ? "Catalogue only" : `${asset.previewKind} preview`
    : availabilityLabel(asset.availability);
  return (
    <span className={`asset-placeholder asset-placeholder--${asset.mediaFamily}`}>
      <strong>{asset.extension ? asset.extension.toUpperCase() : asset.mediaFamily.toUpperCase()}</strong>
      <span>{label}</span>
    </span>
  );
}

function contactSheetLayout(view: AssetViewMode, thumbnailSize: number, width: number) {
  const gap = view === "list" ? 8 : 16;
  if (view === "list") {
    return { columns: 1, cardHeight: 96, gap, template: "minmax(0, 1fr)" };
  }
  const cardWidth = view === "compact" ? Math.max(132, Math.round(thumbnailSize * 0.72)) : thumbnailSize;
  const imageHeight = view === "compact" ? cardWidth : Math.round(cardWidth * 0.72);
  const cardHeight = imageHeight + (view === "compact" ? 72 : 92);
  const columns = Math.max(1, Math.floor((width - gap) / (cardWidth + gap)));
  return {
    columns,
    cardHeight,
    gap,
    template: `repeat(${columns}, minmax(0, ${cardWidth}px))`,
  };
}

function isGridPreviewable(asset: AssetSummary): boolean {
  return asset.availability === "present" && ["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function availabilityLabel(value: string): string {
  const labels: Record<string, string> = {
    needs_permission: "Needs permission",
    offline_volume: "Offline volume",
    unreadable: "Catalogue only",
    unavailable: "Unavailable",
    missing: "Missing",
    unsupported: "Catalogue only",
  };
  return labels[value] ?? value;
}

function isNavigationKey(value: string): value is NavigationKey {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(value);
}
