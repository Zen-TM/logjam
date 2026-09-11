import { describe, it, expect } from "vitest";

import { partitionPlaceMedia, STANDALONE_LINK } from "./mediaLink";

describe("partitionPlaceMedia", () => {
  it("destroys attachments and spares standalone files", () => {
    const { deleted, unlinked } = partitionPlaceMedia([
      { id: "photo", origin: null },
      { id: "video", origin: null },
      { id: "imported-gpx", origin: "import" },
      { id: "recorded-gpx", origin: "track" },
    ]);
    expect(deleted.map((r) => r.id)).toEqual(["photo", "video"]);
    expect(unlinked.map((r) => r.id)).toEqual(["imported-gpx", "recorded-gpx"]);
  });

  it("handles a place with no media", () => {
    expect(partitionPlaceMedia([])).toEqual({ deleted: [], unlinked: [] });
  });

  it("spells standalone as a null parent, not an empty string", () => {
    // A "" linkedId would satisfy the old NOT NULL column and quietly match
    // `linkedId: { in: [...] }` lookups for a place that has yet to exist.
    expect(STANDALONE_LINK).toEqual({ linkedType: "none", linkedId: null });
  });
});
