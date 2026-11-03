// The default name a saved area gets before the user renames it.
//
// PRIVACY: it is worked out on the phone from the user's own places, never by
// reverse geocoding: that needs the network and would put a place name (and
// the round trip that derives it) against a region of interest. A coordinate
// in the label breaks shared/DESIGN.md §13 outright. The label lives only in
// the region's own file and the Saved list. Guard: regionName.test.ts.
//
// With no place of the user's own nearby the name is a counter, because two
// areas saved on one trip are the case that needs telling apart, and
// "Region 2" does that where "16 Aug 2026" does not.

/** How far from the framed area's centre a place still names it. */
const NEAR_PLACE_KM = 15;

/**
 * First "Region N" not already in use, counting from 1.
 *
 * Takes every label in play — the registry's rows AND the runs still
 * downloading — because the artifact for a run enqueued a minute ago may not
 * exist yet, and two taps in a row must not both produce "Region 1". Guard:
 * mobile/src/map/regionName.test.ts.
 */
export function nextRegionName(
  existingLabels: Iterable<string | null | undefined>,
): string {
  const taken = new Set(existingLabels);
  for (let n = 1; ; n += 1) {
    const name = `Region ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * The name of the user's own place nearest the centre of an area, with a
 * number when that name is already taken ("Claustral Canyon 2"), or the
 * counter name when none is within NEAR_PLACE_KM.
 */
export function defaultRegionName(
  centre: { lat: number; lng: number } | null,
  places: Iterable<{ name: string; latitude: number; longitude: number }>,
  existingLabels: Iterable<string | null | undefined>,
): string {
  const taken = new Set(existingLabels);
  let nearest: string | null = null;
  let best = NEAR_PLACE_KM;
  if (centre) {
    const kmPerLng = 111.32 * Math.cos((centre.lat * Math.PI) / 180);
    for (const place of places) {
      const name = place.name.trim();
      if (!name) continue;
      const km = Math.hypot(
        (place.latitude - centre.lat) * 110.57,
        (place.longitude - centre.lng) * kmPerLng,
      );
      if (km < best) {
        best = km;
        nearest = name;
      }
    }
  }
  if (nearest == null) return nextRegionName(taken);
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? nearest : `${nearest} ${n}`;
    if (!taken.has(name)) return name;
  }
}
