import {
  formatDistanceM,
  formatDurationMs,
  PAIRED_STAT_LABELS as L,
} from "@logjam/shared";

/**
 * The On foot totals. Time and Distance lead and share a row (`STAT_PAIRS`);
 * Ascent and Longest fill the second row, so the 2 x 2 grid has no gap.
 */
export function onFootStats(t: {
  distanceM: number;
  durationMs: number;
  ascentM: number;
  longestM: number;
}) {
  return [
    { label: L.time, value: formatDurationMs(t.durationMs) },
    { label: L.distance, value: formatDistanceM(t.distanceM) },
    { label: L.ascent, value: `${Math.round(t.ascentM)} m` },
    { label: "Longest", value: formatDistanceM(t.longestM) },
  ];
}
