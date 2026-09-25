import { describe, expect, it } from "vitest";

import {
  ARCHIVE_BOUNDS,
  MAX_CLIP_ZOOM,
  createClipTokenStore,
  validateRegionClipRequest,
} from "./regionClip";
import { redactPaths } from "./logger";

const BLUE_MOUNTAINS = { west: 150.25, south: -33.75, east: 150.37, north: -33.65 };

describe("validateRegionClipRequest", () => {
  it("accepts a sane bush bbox with default maxzoom", () => {
    const result = validateRegionClipRequest(BLUE_MOUNTAINS);
    expect(result).toEqual({
      ok: true,
      value: { bbox: BLUE_MOUNTAINS, maxzoom: MAX_CLIP_ZOOM },
    });
  });

  it("accepts an explicit lower maxzoom, rejects out-of-range ones", () => {
    expect(
      validateRegionClipRequest({ ...BLUE_MOUNTAINS, maxzoom: 12 }),
    ).toMatchObject({ ok: true, value: { maxzoom: 12 } });
    for (const maxzoom of [0, 16, 3.5, "15"]) {
      expect(
        validateRegionClipRequest({ ...BLUE_MOUNTAINS, maxzoom }).ok,
      ).toBe(false);
    }
  });

  it("rejects non-numeric, empty, and inverted bounds", () => {
    expect(validateRegionClipRequest(null).ok).toBe(false);
    expect(
      validateRegionClipRequest({ west: "a", south: 1, east: 2, north: 2 }).ok,
    ).toBe(false);
    expect(
      validateRegionClipRequest({ west: 150, south: -33, east: 150, north: -32 })
        .ok,
    ).toBe(false);
    expect(
      validateRegionClipRequest({ west: 150, south: -32, east: 151, north: -33 })
        .ok,
    ).toBe(false);
    expect(
      validateRegionClipRequest({ west: Infinity, south: -33, east: 151, north: -32 })
        .ok,
    ).toBe(false);
  });

  it("rejects regions outside the archive bounds", () => {
    // Tasmania — south of the extract.
    expect(
      validateRegionClipRequest({ west: 146, south: -43, east: 147, north: -42 })
        .ok,
    ).toBe(false);
    // Just inside the SW corner passes.
    expect(
      validateRegionClipRequest({
        west: ARCHIVE_BOUNDS.west + 0.1,
        south: ARCHIVE_BOUNDS.south + 0.1,
        east: ARCHIVE_BOUNDS.west + 0.2,
        north: ARCHIVE_BOUNDS.south + 0.2,
      }).ok,
    ).toBe(true);
  });

  it("rejects areas above the 1,600 km² cap", () => {
    // ~90×90 km.
    expect(
      validateRegionClipRequest({ west: 150, south: -34.4, east: 151, north: -33.6 })
        .ok,
    ).toBe(false);
  });

  it("error strings never echo the submitted coordinates", () => {
    const weird = { west: 150.123456, south: -33.98765, east: 150.2, north: -33.9, maxzoom: 99 };
    const result = validateRegionClipRequest(weird);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toMatch(/150|33|99/);
    }
  });
});

describe("clip token store", () => {
  it("issues and consumes a token exactly once for the owning user", () => {
    const store = createClipTokenStore(60_000);
    const { token } = store.issue({ path: "/tmp/x", userId: "u1", sizeBytes: 10 });
    expect(store.take(token, "u1")).toMatchObject({ path: "/tmp/x" });
    expect(store.take(token, "u1")).toBeNull(); // consumed
  });

  it("another user's take neither returns nor consumes the entry", () => {
    const store = createClipTokenStore(60_000);
    const { token } = store.issue({ path: "/tmp/x", userId: "u1", sizeBytes: 10 });
    expect(store.take(token, "u2")).toBeNull();
    expect(store.take(token, "u1")).not.toBeNull(); // still there for the owner
  });

  it("expired tokens are unusable and swept with their file paths", () => {
    const store = createClipTokenStore(1000);
    const { token } = store.issue({ path: "/tmp/x", userId: "u1", sizeBytes: 10 });
    const later = Date.now() + 2000;
    expect(store.take(token, "u1", later)).toBeNull();
    expect(store.sweepExpired(later)).toEqual(["/tmp/x"]);
    expect(store.size()).toBe(0);
  });
});

describe("privacy: log redaction covers the clip request body", () => {
  it("redactPaths includes every region-bound body field", () => {
    for (const field of ["west", "south", "east", "north"]) {
      expect(redactPaths).toContain(`req.body.${field}`);
    }
  });
});
