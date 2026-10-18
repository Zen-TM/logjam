// The decisions behind the GeoPDF frame while an area is picked on the map.
// Pure, so they are tested without a map; Map.tsx holds the state and calls
// them.
import { metersPerPixel } from "@logjam/shared";
import type { TBbox } from "./Map";

/** What a pick knows about the scale and area the frame arrived with. */
export type FramePick = {
  /** The scale the frame is held at, or null when zooming changes it. */
  kept: number | null;
  /** The scale the frame stands for until the next zoom. */
  initialScale?: number;
  /** Handed back as it is when the map never moved. */
  initialExtent?: TBbox;
  zoomed: boolean;
};

/**
 * Held from the dialog's scale; arriving with only a box (Places' "Make a
 * map") nothing is held, so the box decides.
 */
export function keptScaleOnEntry(initialScale: number | undefined) {
  return initialScale ?? null;
}

/**
 * The scale the frame stands for right now: the kept one; else the one it
 * arrived with until a zoom, so an unzoomed pick returns it exactly rather
 * than re-measured with floating-point drift; else measured from the frame.
 */
export function scaleNow(
  pick: FramePick,
  measure: () => number | null,
): number | null {
  if (pick.kept !== null) return pick.kept;
  if (!pick.zoomed && pick.initialScale) return pick.initialScale;
  return measure();
}

/**
 * Letting go of a kept scale: the frame now stands for exactly that scale
 * until the next zoom, unless a zoom is still running (trackpad momentum, a
 * +/- ease), which is already changing it. The arrival's extent survives only
 * if it was drawn at that same scale; a Places box never was.
 */
export function letGo(
  pick: FramePick & { kept: number },
  zoomingNow: boolean,
): FramePick {
  return {
    kept: null,
    initialScale: pick.kept,
    initialExtent:
      pick.kept === pick.initialScale ? pick.initialExtent : undefined,
    zoomed: zoomingNow,
  };
}

/** The arrival's area and scale, when the map never moved and both are
 *  still true of the frame. */
export function unmovedPick(
  pick: FramePick,
  panned: boolean,
): { extent: TBbox; scale: number } | null {
  if (!pick.initialExtent || !pick.initialScale || panned || pick.zoomed)
    return null;
  if (pick.kept !== null && pick.kept !== pick.initialScale) return null;
  return { extent: pick.initialExtent, scale: pick.initialScale };
}

/**
 * The frame's size on screen while a scale is kept: the paper's map area on
 * the ground, over the ground a pixel covers. Zooming changes this, never the
 * scale.
 */
export function keptFrameSizePx(
  scale: number,
  paperMm: { w: number; h: number },
  zoom: number,
  latDeg: number,
): { w: number; h: number } {
  const mpp = metersPerPixel(latDeg, zoom);
  return {
    w: (scale * paperMm.w) / 1000 / mpp,
    h: (scale * paperMm.h) / 1000 / mpp,
  };
}
