import { metersPerPixel } from "@logjam/shared";
import { describe, expect, it, vi } from "vitest";
import {
  afterEase,
  type EasingCamera,
  type FramePick,
  keptFrameSizePx,
  keepScale,
  keptScaleOnEntry,
  letGo,
  scaleNow,
  unmovedPick,
} from "./geoPdfFrame";

const box = { north: -33.6, south: -33.7, east: 150.3, west: 150.2 };
const measured = () => 23417;

// From the dialog the scale is kept; from Places' box-only "Make a map"
// nothing is, so the box decides. Mutation: `?? null` → `?? 25000`.
describe("keptScaleOnEntry", () => {
  it("keeps the dialog's scale, and nothing for a box alone", () => {
    expect(keptScaleOnEntry(25000)).toBe(25000);
    expect(keptScaleOnEntry(undefined)).toBeNull();
  });
});

// Mutations: drop the kept branch (a kept scale is re-measured, and zooming
// changes it); drop the unzoomed-initial branch (an untouched pick comes back
// as 24 998).
describe("scaleNow", () => {
  const pick: FramePick = { kept: null, initialScale: 25000, zoomed: false };

  it("is the kept scale, whatever the zoom", () => {
    expect(scaleNow({ ...pick, kept: 50000, zoomed: true }, measured)).toBe(
      50000,
    );
  });

  it("is the arrival's scale until a zoom, then measured", () => {
    expect(scaleNow(pick, measured)).toBe(25000);
    expect(scaleNow({ ...pick, zoomed: true }, measured)).toBe(23417);
  });
});

// Letting go hands the frame exactly the kept scale until the next zoom.
// Mutations: keep `initialExtent` regardless (Places box, Keep on then off,
// Confirm unmoved returns the raw box with the measured scale); clear
// `zoomed` while a zoom is still running (the label and Confirm keep a scale
// the zoom is already changing).
describe("letGo, then Confirm without moving", () => {
  it("never returns a Places box with a scale it was not drawn at", () => {
    // Places: a box and no scale; Keep on holds the measured scale.
    const arrival: FramePick = {
      kept: keptScaleOnEntry(undefined),
      initialExtent: box,
      zoomed: false,
    };
    const kept = scaleNow(arrival, measured) as number;
    const after = letGo({ ...arrival, kept }, false);

    expect(after.initialScale).toBe(23417);
    expect(unmovedPick(after, false)).toBeNull();
  });

  it("keeps the dialog's area when let go at the scale it came with", () => {
    const arrival: FramePick = {
      kept: 25000,
      initialScale: 25000,
      initialExtent: box,
      zoomed: false,
    };
    const after = letGo({ ...arrival, kept: 25000 }, false);
    expect(unmovedPick(after, false)).toEqual({ extent: box, scale: 25000 });
  });

  it("counts a zoom still running as a zoom", () => {
    const after = letGo(
      { kept: 25000, initialScale: 25000, zoomed: true },
      true,
    );
    expect(after.zoomed).toBe(true);
    expect(scaleNow(after, measured)).toBe(23417);
  });

  // Mutation: `zoomed: zoomingNow` → `zoomed: pick.zoomed` (keep, zoom, let
  // go after the zoom ends: the label and Confirm show a re-measured scale).
  it("stands for exactly the kept scale once a past zoom has ended", () => {
    const after = letGo(
      { kept: 25000, initialScale: 25000, zoomed: true },
      false,
    );
    expect(after.zoomed).toBe(false);
    expect(scaleNow(after, measured)).toBe(25000);
  });
});

// Mutations: round every scale on Keep (a fractional arrival scale no longer
// matches, and an unmoved Keep off, on, Confirm moves the edges by metres);
// drop the rounding (Confirm hands the dialog 23417.38).
describe("keepScale", () => {
  it("keeps an exact arrival scale, so nothing moved returns the area", () => {
    const arrival: FramePick = {
      kept: 23417.38,
      initialScale: 23417.38,
      initialExtent: box,
      zoomed: false,
    };
    const off = letGo({ ...arrival, kept: 23417.38 }, false);
    const on = { ...off, kept: keepScale(off, measured) };
    expect(unmovedPick(on, false)).toEqual({ extent: box, scale: 23417.38 });
  });

  it("rounds a measured scale", () => {
    const pick: FramePick = { kept: null, zoomed: true };
    expect(keepScale(pick, () => 23417.38)).toBe(23417);
  });
});

// Mutation: drop the `panned` check (a moved frame snaps back to its arrival).
describe("unmovedPick", () => {
  it("is the arrival only while the map has not moved", () => {
    const pick: FramePick = {
      kept: 25000,
      initialScale: 25000,
      initialExtent: box,
      zoomed: false,
    };
    expect(unmovedPick(pick, false)).toEqual({ extent: box, scale: 25000 });
    expect(unmovedPick(pick, true)).toBeNull();
  });
});

// A kept scale holds the frame to the paper's ground size, so a zoom grows
// or shrinks the frame on screen. Mutations: leave out the zoom (the frame
// stays put and the area silently changes scale); size from the sheet's
// height for its width.
describe("keptFrameSizePx", () => {
  const a4MapArea = { w: 190, h: 277 };

  it("is the paper's ground size in pixels", () => {
    const px = keptFrameSizePx(25000, a4MapArea, 14, -33.7);
    expect(px.w * metersPerPixel(-33.7, 14)).toBeCloseTo(4750, 6);
    expect(px.h * metersPerPixel(-33.7, 14)).toBeCloseTo(6925, 6);
  });

  it("doubles with each zoom level in", () => {
    const out = keptFrameSizePx(25000, a4MapArea, 13, -33.7);
    const zoomedIn = keptFrameSizePx(25000, a4MapArea, 14, -33.7);
    expect(zoomedIn.w).toBeCloseTo(out.w * 2, 6);
  });

  // A short viewport zooms Logjam Web below 0. Mutation: pass the live zoom
  // to metersPerPixel (it throws, and the throw replaces the app).
  it("sizes the frame below zoom 0", () => {
    const z0 = keptFrameSizePx(25000, a4MapArea, 0, -33.7);
    expect(keptFrameSizePx(25000, a4MapArea, -1, -33.7).w).toBeCloseTo(
      z0.w / 2,
      9,
    );
  });
});

// The opening ease ends in a `moveend`, which marks the frame measured so a
// kept scale may size it. Mutation: always wait for `moveend` (under reduced
// motion it already fired inside easeTo, so the kept frame stays unsized
// until the user's first move).
describe("afterEase", () => {
  function camera(moving: boolean) {
    const listeners = new Set<() => void>();
    const map: EasingCamera = {
      isMoving: () => moving,
      once: (_type, fn) => listeners.add(fn),
      off: (_type, fn) => listeners.delete(fn),
    };
    return { map, listeners };
  }

  it("runs at once when the ease already ended (reduced motion)", () => {
    const { map, listeners } = camera(false);
    const done = vi.fn();
    afterEase(map, done);
    expect(done).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it("waits for the ease's moveend, and stops waiting when undone", () => {
    const { map, listeners } = camera(true);
    const done = vi.fn();
    const stop = afterEase(map, done);
    expect(done).not.toHaveBeenCalled();
    expect(listeners.size).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});
