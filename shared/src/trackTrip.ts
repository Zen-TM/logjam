import { todayDateKey } from "./logbook.js";
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
 * The recordings a trip has already been logged from, given the account's trip
 * attachments (each copy names its source in `sourceMediaId`). "Log a trip" is
 * offered on a recording only when its media id is not in this set. A copy made
 * before the link existed names nothing, so its recording is offered again.
 */
export function tripLoggedTrackIds(
  tripMedia: readonly { sourceMediaId?: string | null }[],
): Set<string> {
  const ids = new Set<string>();
  for (const media of tripMedia) {
    if (media.sourceMediaId) ids.add(media.sourceMediaId);
  }
  return ids;
}
