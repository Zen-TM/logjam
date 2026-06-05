import { describe, it, expect } from "vitest";
import {
  mediaCategory,
  categoryHasThumbnail,
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
