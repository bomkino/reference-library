import { describe, expect, it } from "vitest";
import type { AssetDetail, AssetSummary } from "@pitchdog/reference-bridge";
import {
  MAX_COMPARE_ASSETS,
  addShortlistRange,
  compareAssets,
  mergeAssetDetail,
  moveSelectionIndex,
  refreshSelectedAsset,
  refreshShortlistedAssets,
  replaceShortlistedAsset,
  scrollTopForSelection,
  toggleShortlistedAsset,
} from "./selection";

describe("stable virtual selection", () => {
  it("uses logical indices and clamps at catalogue bounds", () => {
    expect(moveSelectionIndex(12, "ArrowDown", 5, 100_000)).toBe(17);
    expect(moveSelectionIndex(0, "ArrowLeft", 5, 100_000)).toBe(0);
    expect(moveSelectionIndex(99_999, "ArrowRight", 5, 100_000)).toBe(99_999);
    expect(moveSelectionIndex(200, "Home", 5, 100_000)).toBe(0);
    expect(moveSelectionIndex(200, "End", 5, 100_000)).toBe(99_999);
  });

  it("keeps Interface Scale outside selection semantics", () => {
    const compact = moveSelectionIndex(12, "ArrowDown", 5, 100);
    const extraLarge = moveSelectionIndex(12, "ArrowDown", 5, 100);
    expect(compact).toBe(extraLarge);
  });

  it("scrolls an unloaded logical target into the virtual window", () => {
    expect(scrollTopForSelection(500, 5, 240, 960, 0)).toBe(23_280);
    expect(scrollTopForSelection(12, 5, 240, 960, 0)).toBe(0);
    expect(scrollTopForSelection(5, 5, 240, 960, 5_000)).toBe(240);
  });

  it("preserves identity while refreshing renamed and missing summaries", () => {
    const selected = asset("asset-1", "before.png", "present");
    const renamed = asset("asset-1", "after.png", "present");
    expect(refreshSelectedAsset(selected, [renamed])).toBe(renamed);

    const missing = asset("asset-1", "after.png", "missing");
    expect(refreshSelectedAsset(renamed, [missing])).toBe(missing);
    expect(refreshSelectedAsset(missing, [asset("asset-2", "other.png", "present")])).toBe(
      missing,
    );
  });
});

describe("bounded editorial shortlist", () => {
  it("toggles without duplicates and refuses growth beyond the explicit cap", () => {
    const first = asset("asset-1", "one.png", "present");
    const second = asset("asset-2", "two.png", "present");
    expect(toggleShortlistedAsset([], first, 1)).toEqual({ assets: [first], capped: false });
    expect(toggleShortlistedAsset([first], first, 1)).toEqual({ assets: [], capped: false });
    expect(toggleShortlistedAsset([first], second, 1)).toEqual({ assets: [first], capped: true });
  });

  it("adds only loaded logical range members and keeps insertion order", () => {
    const first = asset("asset-1", "one.png", "present");
    const second = asset("asset-2", "two.png", "present");
    const third = asset("asset-3", "three.png", "present");
    const loaded = new Map<number, AssetSummary>([[4, first], [5, second], [7, third]]);
    expect(addShortlistRange([], loaded, 4, 7, 2)).toEqual({
      assets: [first, second],
      capped: true,
    });
  });

  it("refreshes shortlist summaries without dropping offscreen selections", () => {
    const first = asset("asset-1", "before.png", "present");
    const second = asset("asset-2", "two.png", "present");
    const renamed = asset("asset-1", "after.png", "present");
    const refreshed = refreshShortlistedAssets([first, second], [renamed]);
    expect(refreshed).toEqual([renamed, second]);
    expect(refreshShortlistedAssets(refreshed, [])).toBe(refreshed);
  });

  it("merges durable detail into every shortlist surface", () => {
    const summary = asset("asset-1", "before.png", "present");
    const detail = assetDetail(summary, {
      customTitle: "Cover contender",
      reviewState: "keep",
      tags: ["night"],
      usedIn: ["Cover"],
      revision: 4,
    });
    expect(mergeAssetDetail(summary, detail)).toMatchObject({
      displayName: "Cover contender",
      reviewState: "keep",
      tags: ["night"],
      usedIn: ["Cover"],
      revision: 4,
    });
    expect(replaceShortlistedAsset([summary], detail)[0]).toMatchObject({
      displayName: "Cover contender",
      revision: 4,
    });
  });

  it("limits the Compare Board to the explicit four-asset visual bound", () => {
    const assets = Array.from({ length: 8 }, (_, index) => asset(`asset-${index}`, `${index}.png`, "present"));
    expect(compareAssets(assets)).toEqual(assets.slice(0, MAX_COMPARE_ASSETS));
  });
});

function asset(
  assetId: string,
  displayName: string,
  availability: AssetSummary["availability"],
): AssetSummary {
  return {
    assetId,
    locationId: `location-${assetId}`,
    displayName,
    relativeDisplayPath: `Stills/${displayName}`,
    availability,
    mediaFamily: "still",
    mimeType: "image/png",
    extension: "png",
    byteSize: 1_024,
    category: "Stills",
    previewKind: "image",
    reviewState: "unreviewed",
    customTitle: null,
    tags: [],
    usedIn: [],
    previewAssetIds: [],
    createdAtMs: 1,
    revision: 1,
  };
}

function assetDetail(
  summary: AssetSummary,
  patch: Partial<AssetDetail>,
): AssetDetail {
  return {
    assetId: summary.assetId,
    locationId: summary.locationId,
    originalDisplayName: summary.displayName,
    relativeDisplayPath: summary.relativeDisplayPath,
    availability: summary.availability,
    mediaFamily: summary.mediaFamily,
    mimeType: summary.mimeType,
    extension: summary.extension,
    byteSize: summary.byteSize,
    category: summary.category,
    previewKind: summary.previewKind,
    reviewState: summary.reviewState,
    customTitle: summary.customTitle,
    note: null,
    tags: summary.tags,
    usedIn: summary.usedIn,
    revision: summary.revision,
    collectionIds: [],
    ...patch,
  };
}
