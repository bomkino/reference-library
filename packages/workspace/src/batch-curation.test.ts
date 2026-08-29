import { describe, expect, it } from "vitest";
import type { AssetDetail, AssetSummary } from "@pitchdog/reference-bridge";
import {
  batchOutcomeMessage,
  buildBatchPatch,
  mergeEditorialTokens,
  parseBatchTokens,
  runBatchCuration,
} from "./batch-curation";

describe("bounded batch curation", () => {
  it("parses comma/newline tokens, strips tag markers and de-duplicates case-insensitively", () => {
    expect(parseBatchTokens("#Night, cold\nnight,  Cover ")).toEqual(["Night", "cold", "Cover"]);
  });

  it("merges additions without rewriting existing token spelling or order", () => {
    expect(mergeEditorialTokens(["Night", "Blue"], ["night", "Cover"])).toEqual([
      "Night",
      "Blue",
      "Cover",
    ]);
  });

  it("produces a minimal patch and skips assets that already match", () => {
    const input = asset("asset-1", { reviewState: "keep", tags: ["Night"] });
    expect(buildBatchPatch(input, { reviewState: "keep", addTags: ["night"] })).toBeNull();
    expect(buildBatchPatch(input, { reviewState: "maybe", addTags: ["Cover"] })).toEqual({
      customTitle: { action: "unchanged" },
      reviewState: "maybe",
      note: { action: "unchanged" },
      tags: { action: "set", value: ["Night", "Cover"] },
      usedIn: { action: "unchanged" },
    });
  });

  it("refreshes each Asset before deciding whether the batch still needs a write", async () => {
    const input = asset("asset-1", { reviewState: "keep", revision: 1 });
    const updates: AssetSummary[] = [];
    const outcome = await runBatchCuration(
      [input],
      { reviewState: "keep" },
      async (summary) => {
        updates.push(summary);
        return detail(summary, { reviewState: "keep", revision: summary.revision + 1 });
      },
      async (summary) => ({ ...summary, reviewState: "maybe", revision: 7 }),
    );
    expect(updates).toMatchObject([{ assetId: "asset-1", reviewState: "maybe", revision: 7 }]);
    expect(outcome.updated).toHaveLength(1);
    expect(outcome.skipped).toBe(0);
  });

  it("continues after a revision conflict and reports honest partial completion", async () => {
    const inputs = [asset("asset-1"), asset("asset-2"), asset("asset-3", { reviewState: "keep" })];
    const outcome = await runBatchCuration(inputs, { reviewState: "keep" }, async (summary) => {
      if (summary.assetId === "asset-2") throw new Error("Revision conflict");
      return detail(summary, { reviewState: "keep", revision: summary.revision + 1 });
    });
    expect(outcome.updated.map((item) => item.assetId)).toEqual(["asset-1"]);
    expect(outcome.failed.map((item) => item.asset.assetId)).toEqual(["asset-2"]);
    expect(outcome.skipped).toBe(1);
    expect(batchOutcomeMessage(outcome)).toBe("Updated 1 · 1 already matched · 1 failed.");
  });
});

function asset(assetId: string, patch: Partial<AssetSummary> = {}): AssetSummary {
  return {
    assetId,
    locationId: `location-${assetId}`,
    displayName: `${assetId}.png`,
    relativeDisplayPath: `Stills/${assetId}.png`,
    availability: "present",
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
    ...patch,
  };
}

function detail(summary: AssetSummary, patch: Partial<AssetDetail> = {}): AssetDetail {
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
