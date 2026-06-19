import { describe, it, expect } from "vitest";
import {
  mediaCategory,
  categoryHasThumbnail,
  randomTrackColor,
  TRACK_COLORS,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  TRACK_MIME_TYPES,
} from "./media.js";

describe("mediaCategory", () => {
  it("maps every image MIME type to 'image'", () => {
    for (const mime of IMAGE_MIME_TYPES) {
      expect(mediaCategory(mime)).toBe("image");
    }
  });
  it("maps every video MIME type to 'video'", () => {
    for (const mime of VIDEO_MIME_TYPES) {
      expect(mediaCategory(mime)).toBe("video");
    }
  });
  it("maps every track MIME type to 'track'", () => {
    for (const mime of TRACK_MIME_TYPES) {
      expect(mediaCategory(mime)).toBe("track");
    }
  });
  it("returns null for an unmapped MIME type", () => {
    expect(mediaCategory("application/pdf")).toBeNull();
    expect(mediaCategory("text/plain")).toBeNull();
    expect(mediaCategory("")).toBeNull();
  });
});

describe("categoryHasThumbnail", () => {
  it("is true for image and video", () => {
    expect(categoryHasThumbnail("image")).toBe(true);
    expect(categoryHasThumbnail("video")).toBe(true);
  });
  it("is false for track", () => {
    expect(categoryHasThumbnail("track")).toBe(false);
  });
});

describe("TRACK_COLORS / randomTrackColor", () => {
  it("is a non-empty palette of valid #rrggbb hex colours", () => {
    expect(TRACK_COLORS.length).toBeGreaterThan(0);
    for (const color of TRACK_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it("always returns a member of the palette", () => {
    for (let i = 0; i < 100; i++) {
      expect(TRACK_COLORS).toContain(randomTrackColor());
    }
  });
});
