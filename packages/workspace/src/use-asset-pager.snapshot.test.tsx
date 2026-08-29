// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ASSET_QUERY,
  type AssetDetail,
  type AssetPage,
  type AssetSummary,
  type ReferenceWorkspaceBridge,
} from "@pitchdog/reference-bridge";
import { useAssetPager, type AssetPager } from "./use-asset-pager";

describe("Asset pager query snapshot", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("discards a changed multi-page snapshot and restarts without duplicates or gaps", async () => {
    const seam = new MutatingQuerySeam();
    let pager: AssetPager | null = null;
    function Probe() {
      pager = useAssetPager(seam.bridge, "session-1", DEFAULT_ASSET_QUERY, 0);
      return <output data-count={pager.items.size}>{pager.total}</output>;
    }

    await act(async () => { root.render(<Probe />); await settle(); });
    await waitFor(() => expect(current(pager).items.size).toBe(100));

    await act(async () => { current(pager).ensureWindow(100, 200); await settle(); });
    await waitFor(() => expect(seam.calls.filter((call) => call.offset === 0)).toHaveLength(2));
    await waitFor(() => expect(current(pager).items.get(0)?.assetId).toBe("revision-2-0"));
    expect([...current(pager).items.values()].every((asset) => asset.assetId.startsWith("revision-2-"))).toBe(true);

    await act(async () => { current(pager).ensureWindow(100, 200); await settle(); });
    await waitFor(() => expect(current(pager).items.size).toBe(200));
    const assets = [...current(pager).items.entries()].sort(([left], [right]) => left - right);
    expect(assets.map(([index]) => index)).toEqual(Array.from({ length: 200 }, (_, index) => index));
    expect(new Set(assets.map(([, asset]) => asset.assetId)).size).toBe(200);
    expect(assets.every(([index, asset]) => asset.assetId === `revision-2-${index}`)).toBe(true);
    expect(assets[150]?.[1].availability).toBe("unsupported");
    expect(seam.calls).toEqual([
      { offset: 0, expectedLibraryRevision: null },
      { offset: 100, expectedLibraryRevision: 1 },
      { offset: 0, expectedLibraryRevision: null },
      { offset: 100, expectedLibraryRevision: 2 },
    ]);
  });
  it("refreshes every visible parity field after an editorial update", async () => {
    const initial = asset(1, 0);
    const bridge = {
      queryAssets: async (): Promise<AssetPage> => ({
        offset: 0,
        limit: 100,
        total: 1,
        items: [initial],
        nextOffset: null,
        libraryRevision: 1,
        facets: { categories: [], extensions: [], mediaFamilies: [], tags: [], usedIn: [] },
      }),
    } as unknown as ReferenceWorkspaceBridge;
    let pager: AssetPager | null = null;
    function Probe() {
      pager = useAssetPager(bridge, "session-1", DEFAULT_ASSET_QUERY, 0);
      return <output>{pager.items.get(0)?.displayName}</output>;
    }
    await act(async () => { root.render(<Probe />); await settle(); });
    await waitFor(() => expect(current(pager).items.get(0)?.assetId).toBe(initial.assetId));

    const detail: AssetDetail = {
      assetId: initial.assetId,
      locationId: "location-updated",
      originalDisplayName: "Frame 0.jpg",
      relativeDisplayPath: "Boards/Frame 0.jpg",
      mediaFamily: "design",
      mimeType: "application/pdf",
      extension: "pdf",
      byteSize: 8_192,
      category: "Boards",
      previewKind: "pdf",
      availability: "present",
      reviewState: "keep",
      customTitle: "Cover contender",
      note: "Strong negative space",
      tags: ["cover", "night"],
      usedIn: ["Cover"],
      revision: 4,
      collectionIds: [],
    };
    await act(async () => { current(pager).refreshSummary(detail); await settle(); });
    expect(current(pager).items.get(0)).toMatchObject({
      locationId: "location-updated",
      displayName: "Cover contender",
      relativeDisplayPath: "Boards/Frame 0.jpg",
      mediaFamily: "design",
      mimeType: "application/pdf",
      extension: "pdf",
      byteSize: 8_192,
      category: "Boards",
      previewKind: "pdf",
      reviewState: "keep",
      tags: ["cover", "night"],
      usedIn: ["Cover"],
      revision: 4,
    });
  });

});

class MutatingQuerySeam {
  revision = 1;
  mutateOnSecondPage = true;
  calls: Array<{ offset: number; expectedLibraryRevision: number | null | undefined }> = [];

  bridge = {
    queryAssets: async (input: Parameters<ReferenceWorkspaceBridge["queryAssets"]>[0]): Promise<AssetPage> => {
      this.calls.push({ offset: input.offset, expectedLibraryRevision: input.expectedLibraryRevision });
      if (input.offset === 100 && this.mutateOnSecondPage) {
        this.mutateOnSecondPage = false;
        this.revision = 2;
      }
      if (input.expectedLibraryRevision !== null && input.expectedLibraryRevision !== undefined &&
          input.expectedLibraryRevision !== this.revision) {
        throw Object.assign(new Error("query snapshot changed"), { code: "QuerySnapshotChanged" });
      }
      const items = Array.from({ length: 100 }, (_, index) => asset(this.revision, input.offset + index));
      return {
        offset: input.offset,
        limit: input.limit,
        total: 250,
        items,
        nextOffset: input.offset + items.length < 250 ? input.offset + items.length : null,
        libraryRevision: this.revision,
        facets: { categories: [], extensions: [], mediaFamilies: [], tags: [], usedIn: [] },
      };
    },
  } as ReferenceWorkspaceBridge;
}

function asset(revision: number, index: number): AssetSummary {
  return {
    assetId: `revision-${revision}-${index}`,
    locationId: `location-${index}`,
    displayName: `Frame ${index}`,
    relativeDisplayPath: `Stills/Frame ${index}`,
    mediaFamily: "still",
    mimeType: "image/jpeg",
    extension: "jpg",
    byteSize: 1_024 + index,
    category: "Stills",
    previewKind: "image",
    availability: revision === 2 && index === 150 ? "unsupported" : "present",
    reviewState: "unreviewed",
    customTitle: null,
    tags: [],
    usedIn: [],
    previewAssetIds: [],
    createdAtMs: index + 1,
    revision,
  };
}

function current(value: AssetPager | null): AssetPager {
  if (!value) throw new Error("pager not mounted");
  return value;
}

async function waitFor(assertion: () => void) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { assertion(); return; }
    catch (error) { if (attempt === 39) throw error; await act(settle); }
  }
}

async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
