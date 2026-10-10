import { todayDateKey } from "./logbook.js";

/**
 * What a track already knows that the trip form holds, for "Log a trip" on a
 * track (shared/DESIGN.md §10: a shortcut opens the real form, pre-filled).
 *
 * `date` is the track's own LOCAL day, not its UTC day: a descent that started
 * at 7:30 on an AEDT morning began the evening before in UTC, and a trip filed
 * under the day before is the first thing a user would notice. `timeZone` is
 * for tests; the clients leave it out and get the device's.
 *
 * `placeIds` is the place the track is linked to, if it is on one. The name is
 * left to the form: a track's own name is rarely a trip's.
 */
export type TripPrefill = {
  /** "YYYY-MM-DD". */
  date: string;
  placeIds: string[];
};

export function tripPrefillFromTrack(
  track: { startedAt: string | null; placeId?: string | null },
  timeZone?: string,
): TripPrefill {
  const started = track.startedAt ? new Date(track.startedAt) : null;
  const known = started !== null && !Number.isNaN(started.getTime());
  return {
    date: !known
      ? todayDateKey()
      : timeZone
        ? // en-CA formats as YYYY-MM-DD.
          new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(started)
        : todayDateKey(started),
    placeIds: track.placeId ? [track.placeId] : [],
  };
}
