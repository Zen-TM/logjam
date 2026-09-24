import { describe, it, expect } from "vitest";
import {
  mediaCategory,
  categoryHasThumbnail,
  randomTrackColor,
  pickNextTrackColor,
  pickTrackColorByIndex,
  TRACK_COLORS,
  TRACK_COLOR_NAMES,
  trackColorName,
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

describe("pickTrackColorByIndex", () => {
  it("returns colours sequentially from the palette", () => {
    for (let i = 0; i < TRACK_COLORS.length; i++) {
      expect(pickTrackColorByIndex(i)).toBe(TRACK_COLORS[i]);
    }
  });
  it("wraps modulo the palette length", () => {
    expect(pickTrackColorByIndex(TRACK_COLORS.length)).toBe(TRACK_COLORS[0]);
    expect(pickTrackColorByIndex(TRACK_COLORS.length + 1)).toBe(TRACK_COLORS[1]);
    expect(pickTrackColorByIndex(25)).toBe(TRACK_COLORS[25 % TRACK_COLORS.length]);
  });
  it("handles negative or non-integer indices safely", () => {
    expect(pickTrackColorByIndex(-5)).toBe(TRACK_COLORS[0]);
    expect(pickTrackColorByIndex(2.7)).toBe(TRACK_COLORS[2]);
  });
});

describe("pickNextTrackColor", () => {
  it("returns first palette colour when existing list is empty", () => {
    expect(pickNextTrackColor([])).toBe(TRACK_COLORS[0]);
  });

  it("returns first unused colour in palette order", () => {
    expect(pickNextTrackColor([TRACK_COLORS[0]])).toBe(TRACK_COLORS[1]);
    expect(pickNextTrackColor([TRACK_COLORS[0], TRACK_COLORS[1]])).toBe(TRACK_COLORS[2]);
    expect(pickNextTrackColor([TRACK_COLORS[1], TRACK_COLORS[2]])).toBe(TRACK_COLORS[0]);
  });

  it("ignores null, undefined, and unrecognized colours", () => {
    expect(pickNextTrackColor([null, undefined, "#123456", "not-a-color"])).toBe(TRACK_COLORS[0]);
    expect(
      pickNextTrackColor([null, TRACK_COLORS[0], undefined, "#ffffff"]),
    ).toBe(TRACK_COLORS[1]);
  });

  it("returns lowest frequency colour when all palette colours are used", () => {
    // Every colour used once except index 3 used once, and all others used twice
    const used = [
      ...TRACK_COLORS,
      ...TRACK_COLORS.filter((_, i) => i !== 3),
    ];
    expect(pickNextTrackColor(used)).toBe(TRACK_COLORS[3]);
  });

  it("breaks frequency ties by first palette colour order", () => {
    // All colours used twice
    const used = [...TRACK_COLORS, ...TRACK_COLORS];
    expect(pickNextTrackColor(used)).toBe(TRACK_COLORS[0]);
  });
});

describe("trackColorName", () => {
  it("names every colour in the palette", () => {
    for (const color of TRACK_COLORS) {
      const name = trackColorName(color);
      expect(name).not.toBe(color);
      expect(name).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  // The names are what a user hears; two swatches answering to one word would
  // make the picker unusable by voice or screen reader.
  it("gives each colour a distinct name", () => {
    const names = TRACK_COLORS.map(trackColorName);
    expect(new Set(names).size).toBe(TRACK_COLORS.length);
  });

  // The declaration and the palette are two lists that must agree.
  it("names the palette and nothing else", () => {
    expect(Object.keys(TRACK_COLOR_NAMES).sort()).toEqual([...TRACK_COLORS].sort());
  });

  it("is case-insensitive, since a stored hex may be upper case", () => {
    expect(trackColorName("#E6194B")).toBe("Red");
  });

  // Unhelpful beats wrong: a route drawn before the palette existed carries an
  // arbitrary hex, and inventing a word for it would hide which colour it is.
  it("hands back an off-palette colour as its hex", () => {
    expect(trackColorName("#123456")).toBe("#123456");
  });

  it("says so when there is no colour at all", () => {
    expect(trackColorName(null)).toBe("No colour");
    expect(trackColorName(undefined)).toBe("No colour");
  });
});
