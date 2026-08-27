import { describe, expect, it } from "vitest";
import {
  MAX_ASSET_NOTE_SCALARS,
  MAX_ASSET_TITLE_SCALARS,
  MAX_COLLECTION_NAME_SCALARS,
  MAX_SEARCH_SCALARS,
  unicodeScalarLength,
} from "@pitchdog/reference-bridge";
import { safeRelativeDisplayPath, textLimitError } from "./text-boundaries";
import { textPatch } from "./use-asset-editor";
import { focalScrollOffset } from "./asset-preview";
import { safeErrorMessage } from "./safe-errors";

describe("Unicode scalar boundaries", () => {
  it("counts astral and combining input with Core-compatible scalar semantics", () => {
    expect(unicodeScalarLength("😀")).toBe(1);
    expect(unicodeScalarLength("e\u0301")).toBe(2);
    expect(textLimitError("😀".repeat(MAX_SEARCH_SCALARS), MAX_SEARCH_SCALARS, "Search", true)).toBeNull();
    expect(textLimitError("😀".repeat(MAX_SEARCH_SCALARS + 1), MAX_SEARCH_SCALARS, "Search", true)).toContain("200");
    expect(textLimitError("e\u0301".repeat(MAX_COLLECTION_NAME_SCALARS / 2), MAX_COLLECTION_NAME_SCALARS, "Collection", true)).toBeNull();
    expect(textLimitError("e\u0301".repeat(MAX_COLLECTION_NAME_SCALARS / 2 + 1), MAX_COLLECTION_NAME_SCALARS, "Collection", true)).toContain("200");
    expect(textLimitError("😀".repeat(MAX_ASSET_TITLE_SCALARS), MAX_ASSET_TITLE_SCALARS, "Title")).toBeNull();
    expect(textLimitError("😀".repeat(MAX_ASSET_TITLE_SCALARS + 1), MAX_ASSET_TITLE_SCALARS, "Title")).toContain("500");
    expect(textLimitError("😀".repeat(MAX_ASSET_NOTE_SCALARS), MAX_ASSET_NOTE_SCALARS, "Note")).toBeNull();
    expect(textLimitError("😀".repeat(MAX_ASSET_NOTE_SCALARS + 1), MAX_ASSET_NOTE_SCALARS, "Note")).toContain("5,000");
  });

  it("clears blank curation while preserving nonblank note whitespace", () => {
    expect(textPatch("old", " \n ", true)).toEqual({ action: "clear" });
    expect(textPatch("old", " \n ", false)).toEqual({ action: "clear" });
    expect(textPatch(null, "  editorial note  ", false)).toEqual({ action: "set", value: "  editorial note  " });
    expect(textPatch(null, "  title  ", true)).toEqual({ action: "set", value: "title" });
  });
});

describe("Preview focal point", () => {
  it("preserves the viewport center while zooming and clamps edges", () => {
    expect(focalScrollOffset(250, 500, 1_000, 2_000)).toBe(750);
    expect(focalScrollOffset(0, 500, 1_000, 2_000)).toBe(250);
    expect(focalScrollOffset(500, 500, 1_000, 2_000)).toBe(1_250);
    expect(focalScrollOffset(500, 500, 1_000, 400)).toBe(0);
  });
});

describe("relative display paths", () => {
  it("shows only safe relative values", () => {
    expect(safeRelativeDisplayPath("Stills/scene/frame.jpg")).toBe("Stills/scene/frame.jpg");
    for (const unsafe of ["/Users/name/frame.jpg", "C:\\secret\\frame.jpg", "../frame.jpg", "file:///tmp/frame.jpg", "bad\u0000path"]) {
      expect(safeRelativeDisplayPath(unsafe)).toBe("Relative path unavailable");
    }
  });
});

describe("renderer-safe errors", () => {
  it("never forwards raw messages or native paths", () => {
    expect(safeErrorMessage(new Error("failed at /Users/private/secret.jpg"), "Preview failed.")).toBe("Preview failed.");
    expect(safeErrorMessage({ code: "LibraryIntegrityFailedPreserved", message: "/private/library.sqlite" }, "Open failed.")).toBe("This Library failed integrity checks and was preserved unchanged. Open a backup or copy; no repair was attempted.");
  });
});
