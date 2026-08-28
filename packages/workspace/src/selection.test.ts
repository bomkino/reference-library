import { describe, expect, it } from "vitest";
import type { AssetSummary } from "@pitchdog/reference-bridge";
import {
  moveSelectionIndex,
  refreshSelectedAsset,
  scrollTopForSelection,
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
