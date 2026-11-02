import { formatTripDate, todayDateKey } from "./logbook.js";
import { haversineMeters } from "./placeGeo.js";

/**
 * What a track already knows that the trip form holds, for "Log a trip" on a
 * track (shared/DESIGN.md §10: a shortcut opens the real form, pre-filled).
 *
 * `date` is the track's own LOCAL day, not its UTC day: a descent that started
 * at 7:30 on an AEDT morning began the evening before in UTC, and a trip filed
 * under the day before is the first thing a user would notice. `timeZone` is
 * for tests (test: shared/src/trackTrip.test.ts); the clients leave it out
 * and get the device's.
 *
 * `placeIds` is the place the track is linked to, if it is on one. The name is
 * left to the form: a track's own name is rarely a trip's.
 */
export type TripPrefill = {
  /** "YYYY-MM-DD". */
  date: string;
  placeIds: string[];
  /**
   * Saved places near where the track started and ended, nearest first, for
   * the form to OFFER: they are never linked for the user, since a track that
   * ends at a car park is near places it never visited. Empty where the
   * track's ends or the places are not known.
   */
  nearPlaceIds: string[];
};

export type LatLng = { latitude: number; longitude: number };

const NEAR_PLACE_METERS = 2000;
const NEAR_PLACE_LIMIT = 3;

/** Saved places within 2 km of either end of a track, nearest first, at most 3. */
export function placesNearTrackEnds(
  ends: readonly LatLng[],
  places: readonly (LatLng & { id: string })[],
): string[] {
  return places
    .map((place) => ({
      id: place.id,
      meters: Math.min(
        ...ends.map((end) =>
          haversineMeters(
            end.latitude,
            end.longitude,
            place.latitude,
            place.longitude,
          ),
        ),
      ),
    }))
    .filter((place) => place.meters <= NEAR_PLACE_METERS)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, NEAR_PLACE_LIMIT)
    .map((place) => place.id);
}

/** First and last point of a GPX, read from its text; empty when it has none. */
export function gpxEnds(gpx: string): LatLng[] {
  const points = [
    ...gpx.matchAll(
      /<(?:trkpt|rtept)\b[^>]*?\blat="(-?[\d.]+)"[^>]*?\blon="(-?[\d.]+)"/g,
    ),
  ].map((m) => ({ latitude: Number(m[1]), longitude: Number(m[2]) }));
  const first = points[0];
  const last = points[points.length - 1];
  return first && last ? [first, last] : [];
}

/** Whole days a track still counts as "to log" for. */
export const RECORDINGS_TO_LOG_DAYS = 30;

/**
 * Recordings from the last 30 days whose local day has no trip: the ones still
 * to log, newest first. Matched by DAY, not by a link from trip to track (the
 * API has none), so a trip logged on the same day for another walk hides it.
 *
 * Both sides are local days: a track's via `tripPrefillFromTrack`, a trip's
 * from its stored UTC-midnight date, which is its user's local day by
 * construction (`todayDateKey`). Comparing the track's UTC day instead drops a
 * 7:30 AEDT start into the day before (test: shared/src/trackTrip.test.ts).
 */
export function recordingsToLog<T extends { startedAt: string | null }>(
  tracks: readonly T[],
  trips: readonly { date: string }[],
  today: Date = new Date(),
  timeZone?: string,
): T[] {
  const loggedDays = new Set(trips.map((trip) => trip.date.slice(0, 10)));
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - RECORDINGS_TO_LOG_DAYS);
  const oldest = todayDateKey(cutoff);
  const newest = todayDateKey(today);
  return tracks
    .filter((track) => {
      if (!track.startedAt || Number.isNaN(Date.parse(track.startedAt)))
        return false;
      const day = tripPrefillFromTrack(track, timeZone).date;
      return day >= oldest && day <= newest && !loggedDays.has(day);
    })
    .sort(
      (a, b) => Date.parse(b.startedAt ?? "") - Date.parse(a.startedAt ?? ""),
    );
}

export function tripPrefillFromTrack(
  track: {
    startedAt: string | null;
    placeId?: string | null;
    /** Where the track began and ended, where known. */
    ends?: readonly LatLng[];
  },
  timeZone?: string,
  places: readonly (LatLng & { id: string })[] = [],
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
    nearPlaceIds: track.ends?.length
      ? placesNearTrackEnds(track.ends, places).filter(
          (id) => id !== track.placeId,
        )
      : [],
  };
}

/**
 * A recording's local day as a logbook line ("Sun 15 Mar 2026"). Not
 * `formatTripDate(startedAt)`, which reads a stored UTC-midnight trip date and
 * would show a morning walk under the day before.
 */
export function trackDayLabel(
  startedAt: string | null,
  timeZone?: string,
): string {
  return formatTripDate(
    `${tripPrefillFromTrack({ startedAt }, timeZone).date}T00:00:00.000Z`,
  );
}
