import { describe, expect, it } from "vitest";
import { computeVirtualWindow } from "./virtual-window";

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
});
