import { describe, expect, it } from "vitest";
import { computeVirtualWindow } from "./virtual-window";
import { PAGE_CACHE_LIMIT, retainedPageOffsets } from "./use-asset-pager";

describe("bounded contact-sheet virtualization", () => {
  it("renders a tiny bounded window for 100,000 Assets", () => {
    const window = computeVirtualWindow({
      itemCount: 100_000,
      columns: 6,
      rowHeight: 240,
      viewportHeight: 900,
      scrollTop: 1_200_000,
      overscanRows: 3,
    });
    expect(window.renderedCount).toBeLessThanOrEqual(66);
    expect(window.startIndex).toBeGreaterThan(0);
    expect(window.endIndexExclusive).toBeLessThan(100_000);
    expect(window.totalHeight).toBeGreaterThan(3_000_000);
  });

  it("returns a truthful empty window", () => {
    expect(
      computeVirtualWindow({
        itemCount: 0,
        columns: 4,
        rowHeight: 200,
        viewportHeight: 800,
        scrollTop: 0,
      }),
    ).toMatchObject({ renderedCount: 0, totalHeight: 0 });
  });

  it("bounds page data and recency metadata during long catalogue traversal", () => {
    const access = new Map(Array.from({ length: 100 }, (_, index) => [index * 100, index]));
    const retained = retainedPageOffsets(access, PAGE_CACHE_LIMIT);
    expect(retained).toHaveLength(8);
    expect(retained).toEqual([9_900, 9_800, 9_700, 9_600, 9_500, 9_400, 9_300, 9_200]);
  });
});
