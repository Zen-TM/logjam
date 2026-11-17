import {
  formatDistanceM,
  formatDurationMs,
  formatHeight,
  PAIRED_STAT_LABELS as L,
  t,
} from "@logjam/shared";

/**
 * The On foot totals. Time and Distance lead and share a row (`STAT_PAIRS`);
 * Ascent and Longest fill the second row, so the 2 x 2 grid has no gap.
 */
export function onFootStats(totals: {
  distanceM: number;
  durationMs: number;
  ascentM: number;
  longestM: number;
}) {
  return [
    { label: L.time, value: formatDurationMs(totals.durationMs) },
    { label: L.distance, value: formatDistanceM(totals.distanceM) },
    { label: L.ascent, value: formatHeight(totals.ascentM) },
    { label: t`Longest`, value: formatDistanceM(totals.longestM) },
  ];
}
