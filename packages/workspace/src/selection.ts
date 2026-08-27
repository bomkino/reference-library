import type { AssetSummary } from "@pitchdog/reference-bridge";

export type NavigationKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export function refreshSelectedAsset(
  selected: AssetSummary | null,
  loadedItems: Iterable<AssetSummary>,
): AssetSummary | null {
  if (!selected) return null;
  for (const item of loadedItems) {
    if (item.assetId === selected.assetId) return item;
  }
  return selected;
}

export function moveSelectionIndex(
  current: number,
  key: NavigationKey,
  columns: number,
  itemCount: number,
): number {
  if (itemCount <= 0) return -1;
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeCurrent = Math.min(Math.max(current, 0), itemCount - 1);
  const proposed =
    key === "ArrowLeft"
      ? safeCurrent - 1
      : key === "ArrowRight"
        ? safeCurrent + 1
        : key === "ArrowUp"
          ? safeCurrent - safeColumns
          : key === "ArrowDown"
            ? safeCurrent + safeColumns
            : key === "Home"
              ? 0
              : itemCount - 1;
  return Math.min(Math.max(proposed, 0), itemCount - 1);
}

export function scrollTopForSelection(
  index: number,
  columns: number,
  rowHeight: number,
  viewportHeight: number,
  currentScrollTop: number,
): number {
  const safeColumns = Math.max(1, Math.floor(columns));
  const itemTop = Math.floor(Math.max(0, index) / safeColumns) * rowHeight;
  const itemBottom = itemTop + rowHeight;
  if (itemTop < currentScrollTop) return itemTop;
  if (itemBottom > currentScrollTop + viewportHeight) {
    return Math.max(0, itemBottom - viewportHeight);
  }
  return currentScrollTop;
}
