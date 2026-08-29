import { describe, expect, it } from "vitest";
import { normalizedPan, panOffsets } from "./compare-board";

describe("synchronized visual comparison", () => {
  it("normalizes one stage and maps it onto different image dimensions", () => {
    const pan = normalizedPan({
      scrollLeft: 50,
      scrollTop: 75,
      scrollWidth: 200,
      scrollHeight: 400,
      clientWidth: 100,
      clientHeight: 100,
    });
    expect(pan).toEqual({ x: 0.5, y: 0.25 });
    expect(panOffsets(pan, {
      scrollWidth: 500,
      scrollHeight: 900,
      clientWidth: 100,
      clientHeight: 100,
    })).toEqual({ left: 200, top: 200 });
  });

  it("treats non-scrollable axes as the stable origin and clamps hostile metrics", () => {
    expect(normalizedPan({
      scrollLeft: 999,
      scrollTop: -20,
      scrollWidth: 100,
      scrollHeight: 200,
      clientWidth: 100,
      clientHeight: 100,
    })).toEqual({ x: 0, y: 0 });
    expect(panOffsets({ x: 3, y: Number.NaN }, {
      scrollWidth: 300,
      scrollHeight: 300,
      clientWidth: 100,
      clientHeight: 100,
    })).toEqual({ left: 200, top: 0 });
  });
});
