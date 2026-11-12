// Pure helpers for the GeoPDF dialog's Area section.
import { formatDistanceM } from "@logjam/shared";

/** The NSW topo series (1:25 000, 1:50 000, 1:100 000); anything else is
 *  typed under Other. */
export const SCALE_PRESETS = [25000, 50000, 100000] as const;

export type ScaleChoice = `${(typeof SCALE_PRESETS)[number]}` | "other";

/**
 * The chip a scale lights. Other once the user has picked it, so the field
 * stays open while they type a preset's number into it, and for any scale
 * that is not a preset (one the map derived from a zoom).
 */
export function scaleChoice(scale: number, otherPicked: boolean): ScaleChoice {
  const preset = SCALE_PRESETS.find((p) => p === scale);
  return otherPicked || preset === undefined ? "other" : `${preset}`;
}

/** The ground a sheet covers, as its size, never its corners
 *  (shared/DESIGN.md §13). */
export function sheetSizeLabel(widthM: number, heightM: number): string {
  return `${formatDistanceM(widthM)} × ${formatDistanceM(heightM)}`;
}
