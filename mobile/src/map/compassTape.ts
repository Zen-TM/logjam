// Tick geometry for the side-scrolling compass tape (CompassStrip).
//
// The tape is a window onto the 360° circle centred on the direction the user
// is facing: a bearing that is `d` degrees clockwise of them is drawn `d *
// pxPerDegree` to the right of the centre line. Pure maths, because the tape is
// the one part of the instrument that can be wrong in a way a screenshot won't
// show — a tick at the wrong side of north is a compass that lies.
import { currentDeclinationDeg, shortestAngleDelta } from "./heading";
import type { NorthReference } from "./mapPreferences";

/**
 * Tape scale. 2.2 px per degree puts ~80° of the circle in the 176 px strip:
 * always at least two labelled 30° marks on screen, which is what makes the
 * centre reading legible without counting ticks, and no more map covered than
 * that needs.
 */
export const COMPASS_PX_PER_DEGREE = 2.2;
/** Unlabelled ticks. */
export const COMPASS_MINOR_STEP = 10;
/** Every third tick is labelled, so a label lands at each cardinal too. */
export const COMPASS_LABEL_STEP = 30;

const CARDINALS: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };

export type CompassTick = {
  /** 0..360, the true-north bearing this tick marks. */
  bearing: number;
  /** Offset from the tape's left edge, in px. */
  x: number;
  major: boolean;
  /** Cardinal letter, or the bearing in degrees; null for a minor tick. */
  label: string | null;
};

/**
 * Ticks visible in a `widthPx`-wide tape centred on `heading` (degrees true).
 * Bearings are always whole multiples of the minor step; only `x` carries the
 * fractional part of the heading, so the tape slides smoothly under fixed marks
 * rather than the marks jittering between integers.
 */
export function compassTicks(
  heading: number,
  widthPx: number,
  pxPerDegree: number = COMPASS_PX_PER_DEGREE,
): CompassTick[] {
  if (!Number.isFinite(heading) || widthPx <= 0) return [];
  const halfSpanDeg = widthPx / 2 / pxPerDegree;
  const centre = ((heading % 360) + 360) % 360;
  const first =
    Math.ceil((centre - halfSpanDeg) / COMPASS_MINOR_STEP) * COMPASS_MINOR_STEP;
  const ticks: CompassTick[] = [];
  for (let raw = first; raw <= centre + halfSpanDeg; raw += COMPASS_MINOR_STEP) {
    const bearing = ((raw % 360) + 360) % 360;
    const major = bearing % COMPASS_LABEL_STEP === 0;
    ticks.push({
      bearing,
      // Through the shortest turn, so a tape centred on 350° draws 10° to the
      // RIGHT of north rather than 340° of tape away off the left edge.
      x: widthPx / 2 + shortestAngleDelta(centre, bearing) * pxPerDegree,
      major,
      label: major ? (CARDINALS[bearing] ?? String(bearing)) : null,
    });
  }
  return ticks;
}

/**
 * The heading to DRAW, given the true-north heading the sensor produced and the
 * north the user reads bearings from (Settings → Map).
 *
 * Declination is degrees EAST of true north, so the magnetic bearing of a fixed
 * direction is that much SMALLER — 000° true is 347.5° magnetic in NSW, not
 * 012.5°. The value used is whatever `heading.ts` is currently correcting BY,
 * so the tape and the map can never disagree about it. Getting that sign backwards is a 25° error in the direction people
 * walk, which is why it is a named function with a test rather than an
 * expression inside the view.
 */
export function displayHeading(
  trueHeading: number,
  reference: NorthReference,
): number {
  if (reference !== "magnetic") return trueHeading;
  // Exactly what the forward path added, not a second copy of the constant:
  // `resolveTrueHeading` adds the LEARNED declination once a fix has supplied
  // one, so subtracting the NSW literal here left the tape's labels adrift from
  // the map by `learned - 12.5` — small in NSW, unbounded outside it.
  return (((trueHeading - currentDeclinationDeg()) % 360) + 360) % 360;
}
