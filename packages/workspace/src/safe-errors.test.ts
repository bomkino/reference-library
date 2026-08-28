import { describe, expect, it } from "vitest";
import { safeErrorMessage } from "./safe-errors";

describe("safe workspace errors", () => {
  it("turns bounded operational failures into actionable copy", () => {
    expect(safeErrorMessage({ code: "RenditionQueueFull" }, "fallback")).toContain("current thumbnails");
    expect(safeErrorMessage({ code: "RootScanCapacityReached" }, "fallback")).toContain("cancel");
    expect(safeErrorMessage({ code: "SourceRevisionChanged" }, "fallback")).toContain("Rescan");
  });

  it("does not echo arbitrary exception text or host paths", () => {
    expect(safeErrorMessage(new Error("/private/customer/secret/project.pitchlibrary"), "Operation failed.")).toBe("Operation failed.");
  });
});
