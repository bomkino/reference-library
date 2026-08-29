import { describe, expect, it } from "vitest";
import { normalizedPan, panOffsets } from "./compare-board";

describe("Compare Board pan normalization", () => {
  it("normalizes a scrolled stage and maps it onto a differently sized stage", () => {
    const pan = normalizedPan({
      scrollLeft: 300,
      scrollTop: 150,
      scrollWidth: 1_000,
      scrollHeight: 700,
      clientWidth: 400,
      clientHeight: 400,
    });
    expect(pan).toEqual({ x: 0.5, y: 0.5 });
    expect(panOffsets(pan, {
      scrollWidth: 1_600,
      scrollHeight: 1_000,
      clientWidth: 400,
      clientHeight: 400,
    })).toEqual({ left: 600, top: 300 });
  });

  it("uses a centred neutral pan for stages that cannot scroll", () => {
    expect(normalizedPan({
      scrollLeft: 0,
      scrollTop: 0,
      scrollWidth: 400,
      scrollHeight: 400,
      clientWidth: 400,
      clientHeight: 400,
    })).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps invalid normalized inputs before applying offsets", () => {
    expect(panOffsets({ x: -4, y: 8 }, {
      scrollWidth: 900,
      scrollHeight: 900,
      clientWidth: 300,
      clientHeight: 300,
    })).toEqual({ left: 0, top: 600 });
  });
});
