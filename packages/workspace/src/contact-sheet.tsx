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
  selectedAssetId: string | null;
  ensureWindow(start: number, end: number): void;
  onSelect(asset: AssetSummary): void;
  onPreview(asset: AssetSummary): void;
}

export function ContactSheet(props: ContactSheetProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingFocusIndex = useRef<number | null>(null);
  const restoreGridFocus = useRef(false);
  const [geometry, setGeometry] = useState({ width: 900, height: 600, scrollTop: 0 });
  const gap = 12;
  const cardHeight = Math.round(props.thumbnailSize * 0.72 + 58);
  const columns = Math.max(
    1,
    Math.floor((geometry.width - gap) / (props.thumbnailSize + gap)),
  );
  const virtual = useMemo(
    () =>
      computeVirtualWindow({
        itemCount: props.total,
        columns,
        rowHeight: cardHeight + gap,
        viewportHeight: geometry.height,
        scrollTop: geometry.scrollTop,
        overscanRows: 3,
      }),
    [cardHeight, columns, geometry, props.total],
  );
  const ensureWindow = props.ensureWindow;

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
    const update = () =>
      setGeometry((current) => ({
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
    ensureWindow(virtual.startIndex, virtual.endIndexExclusive);
  }, [ensureWindow, virtual.startIndex, virtual.endIndexExclusive]);

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
    () =>
      Array.from(
        { length: virtual.renderedCount },
        (_, index) => virtual.startIndex + index,
      ),
    [virtual],
  );
  const selectedVisibleIndex = indices.find((index) =>
    props.items.get(index)?.assetId === props.selectedAssetId);
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
    const nextIndex = moveSelectionIndex(index, event.key, columns, props.total);
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
        columns,
        cardHeight + gap,
        geometry.height,
        viewport.scrollTop,
      );
    }
    requestAnimationFrame(() => {
      const next = viewportRef.current?.querySelector<HTMLButtonElement>(
        `[data-index="${nextIndex}"]`,
      );
      next?.focus({ preventScroll: true });
    });
  };

  return (
    <div
      className="contact-sheet"
      ref={viewportRef}
      role="grid"
      tabIndex={-1}
      aria-label={`Editorial Contact Sheet, ${props.total} assets`}
      aria-rowcount={Math.ceil(props.total / columns)}
      aria-colcount={columns}
      onScroll={(event) =>
        setGeometry((current) => ({
          ...current,
          scrollTop: event.currentTarget.scrollTop,
        }))
      }
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) {
          restoreGridFocus.current = false;
        }
      }}
    >
      <div className="contact-sheet__canvas" style={{ height: virtual.totalHeight }}>
        <div
          className="contact-sheet__window"
          style={{
            top: virtual.offsetTop,
            gridTemplateColumns: `repeat(${columns}, minmax(0, ${props.thumbnailSize}px))`,
            gridAutoRows: `${cardHeight}px`,
            gap,
          }}
        >
          {indices.map((index) => {
            const asset = props.items.get(index);
            if (!asset) {
              return <div className="asset-card asset-card--loading" key={index} aria-hidden />;
            }
            const selected = props.selectedAssetId === asset.assetId;
            return (
              <button
                className="asset-card"
                data-index={index}
                data-asset-id={asset.assetId}
                key={asset.assetId}
                role="gridcell"
                aria-rowindex={Math.floor(index / columns) + 1}
                aria-colindex={(index % columns) + 1}
                aria-selected={selected}
                aria-label={`${asset.displayName}, ${asset.mediaFamily}, ${asset.reviewState}, ${asset.availability}`}
                tabIndex={index === rovingIndex ? 0 : -1}
                onFocus={() => { restoreGridFocus.current = true; }}
                onClick={() => props.onSelect(asset)}
                onDoubleClick={() => props.onPreview(asset)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.onPreview(asset);
                  handleKey(event, index);
                }}
              >
                <span className="asset-card__image-frame">
                  {asset.availability === "present" ? (
                    <AssetThumbnail
                      source={props.bridge.assetResourceUrl({
                        sessionId: props.sessionId,
                        assetId: asset.assetId,
                        profile: "grid_standard",
                      })}
                    />
                  ) : (
                    <span className="asset-card__missing">Source {asset.availability}</span>
                  )}
                </span>
                <span className="asset-card__name" title={asset.displayName}>
                  {asset.displayName}
                </span>
                <span className="asset-card__state">{asset.reviewState}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AssetThumbnail({ source }: { source: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  return (
    <>
      {state === "loading" && <span className="asset-card__resource-state">Loading preview…</span>}
      {state === "error" && <span className="asset-card__resource-state">Preview unavailable</span>}
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
    </>
  );
}

function isNavigationKey(value: string): value is NavigationKey {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
    value,
  );
}
