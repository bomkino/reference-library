import type { AssetDetail, AssetSummary } from "@pitchdog/reference-bridge";

export type NavigationKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export const MAX_SHORTLIST_ASSETS = 32;
export const MAX_COMPARE_ASSETS = 4;

export interface ShortlistMutation {
  assets: AssetSummary[];
  capped: boolean;
}

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

export function refreshShortlistedAssets(
  shortlisted: readonly AssetSummary[],
  loadedItems: Iterable<AssetSummary>,
): AssetSummary[] {
  if (shortlisted.length === 0) return shortlisted as AssetSummary[];
  const loaded = new Map(Array.from(loadedItems, (asset) => [asset.assetId, asset]));
  let changed = false;
  const refreshed = shortlisted.map((asset) => {
    const replacement = loaded.get(asset.assetId);
    if (replacement && replacement !== asset) {
      changed = true;
      return replacement;
    }
    return asset;
  });
  return changed ? refreshed : shortlisted as AssetSummary[];
}

export function mergeAssetDetail(
  summary: AssetSummary,
  detail: AssetDetail,
): AssetSummary {
  if (summary.assetId !== detail.assetId) return summary;
  return {
    ...summary,
    locationId: detail.locationId,
    displayName: detail.customTitle ?? detail.originalDisplayName,
    relativeDisplayPath: detail.relativeDisplayPath,
    mediaFamily: detail.mediaFamily,
    mimeType: detail.mimeType,
    extension: detail.extension,
    byteSize: detail.byteSize,
    category: detail.category,
    previewKind: detail.previewKind,
    availability: detail.availability,
    reviewState: detail.reviewState,
    customTitle: detail.customTitle,
    tags: detail.tags,
    usedIn: detail.usedIn,
    revision: detail.revision,
  };
}

export function replaceShortlistedAsset(
  shortlisted: readonly AssetSummary[],
  detail: AssetDetail,
): AssetSummary[] {
  let changed = false;
  const next = shortlisted.map((asset) => {
    if (asset.assetId !== detail.assetId) return asset;
    changed = true;
    return mergeAssetDetail(asset, detail);
  });
  return changed ? next : shortlisted as AssetSummary[];
}

export function toggleShortlistedAsset(
  shortlisted: readonly AssetSummary[],
  asset: AssetSummary,
  maximum = MAX_SHORTLIST_ASSETS,
): ShortlistMutation {
  const existing = shortlisted.findIndex((item) => item.assetId === asset.assetId);
  if (existing >= 0) {
    return {
      assets: shortlisted.filter((_, index) => index !== existing),
      capped: false,
    };
  }
  if (shortlisted.length >= maximum) {
    return { assets: shortlisted as AssetSummary[], capped: true };
  }
  return { assets: [...shortlisted, asset], capped: false };
}

export function addShortlistRange(
  shortlisted: readonly AssetSummary[],
  loadedItems: ReadonlyMap<number, AssetSummary>,
  anchorIndex: number,
  targetIndex: number,
  maximum = MAX_SHORTLIST_ASSETS,
): ShortlistMutation {
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  const next = [...shortlisted];
  const known = new Set(shortlisted.map((asset) => asset.assetId));
  let capped = false;

  for (let index = start; index <= end; index += 1) {
    const asset = loadedItems.get(index);
    if (!asset || known.has(asset.assetId)) continue;
    if (next.length >= maximum) {
      capped = true;
      break;
    }
    next.push(asset);
    known.add(asset.assetId);
  }
  return { assets: next, capped };
}

export function compareAssets(
  shortlisted: readonly AssetSummary[],
  maximum = MAX_COMPARE_ASSETS,
): AssetSummary[] {
  return shortlisted.slice(0, Math.max(0, maximum));
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
