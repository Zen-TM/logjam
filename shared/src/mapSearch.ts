// What the map's search box does without asking anyone: read a typed
// coordinate, and remember the places the user picked. Both clients call this
// (ADR 0020); mapSearch.test.ts is the guard for both halves.
//
// PRIVACY: nothing here touches the network or a log. Recents hold place
// names, so each client keeps them on the device only and clears them when the
// account leaves (frontend useAuth.ts, mobile wipeLocalData.ts).
import { fromEastingNorthing } from "./geoPdfExtent.js";

export const RECENT_SEARCHES_HEADING = "Recent searches";
/** What the search box says while it works, finds nothing or fails: one set of
 *  words for Logjam Web's box and Logjam GPS's bar (mapSearch.test.ts). */
export const SEARCH_STATUS = {
  searching: "Searching locations…",
  noPlaces: "No places match.",
  noLocations: "No locations found.",
  searchFailed: "Couldn't search locations.",
  namesFailed: "Couldn't load place names.",
} as const;

export const COORDINATE_RESULT_KIND = "Coordinates";

export interface SearchPoint {
  lat: number;
  lon: number;
  /** What the result row and the recents list show for this point. */
  label: string;
}

// Australia, which is where Logjam is used. A bare "33.71 150.31" has no sign
// to say which number is the latitude, and this is what tells them apart.
const LAT_MAG = [10, 44] as const;
const LON_MAG = [112, 154] as const;
const within = (v: number, [lo, hi]: readonly [number, number]) =>
  v >= lo && v <= hi;

// One coordinate: optional hemisphere letter either side, a degree with
// optional minutes and seconds. A trailing letter must touch its number
// ("33.71S"); a spaced one ("33.71 E") belongs to the next part. D M S need their marks (° ' ") so that
// "33 42 36" is never guessed at.
const PART = String.raw`([NSEW])?\s*(-?\d+(?:\.\d+)?)°?(?:\s*(\d+(?:\.\d+)?)\s*['′’])?(?:\s*(\d+(?:\.\d+)?)\s*(?:"|″|”|''))?([NSEW])?`;
const PAIR = new RegExp(String.raw`^${PART}\s*[,;]?\s*${PART}$`, "i");

interface Part {
  value: number;
  axis: "lat" | "lon" | null;
}

function part(g: (string | undefined)[], at: number): Part | null {
  const pre = g[at];
  const post = g[at + 4];
  if (pre && post) return null;
  const hemi = (pre ?? post)?.toUpperCase();
  const [d, m, s] = [g[at + 1], g[at + 2], g[at + 3]].map((x) =>
    x === undefined ? 0 : Number(x),
  );
  if (m >= 60 || s >= 60) return null;
  const magnitude = Math.abs(d) + m / 60 + s / 3600;
  const negative = d < 0 || Object.is(d, -0);
  if (!hemi) return { value: negative ? -magnitude : magnitude, axis: null };
  return {
    value: hemi === "S" || hemi === "W" ? -magnitude : magnitude,
    axis: hemi === "N" || hemi === "S" ? "lat" : "lon",
  };
}

const fmt = (lat: number, lon: number) =>
  `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

function parseLatLon(text: string): SearchPoint | null {
  const g = PAIR.exec(text);
  if (!g) return null;
  const a = part(g.slice(1, 6), 0);
  const b = part(g.slice(6, 11), 0);
  if (!a || !b) return null;
  let lat: number;
  let lon: number;
  if (a.axis || b.axis) {
    // Letters decide, and both axes must be named once.
    if (a.axis === b.axis || (a.axis === null) !== (b.axis === null)) {
      return null;
    }
    [lat, lon] = a.axis === "lat" ? [a.value, b.value] : [b.value, a.value];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  } else {
    // No letters: the magnitudes say which is which, and a canyon in NSW is
    // south of the equator and east of Greenwich whatever the sign typed.
    const [am, bm] = [Math.abs(a.value), Math.abs(b.value)];
    if (within(am, LAT_MAG) && within(bm, LON_MAG)) [lat, lon] = [am, bm];
    else if (within(bm, LAT_MAG) && within(am, LON_MAG)) [lat, lon] = [bm, am];
    else return null;
    lat = -lat;
  }
  return { lat, lon, label: fmt(lat, lon) };
}

// "56 245000 6264000", "56H 245000E 6264000N", "MGA zone 56 245000mE ...".
// The zone is required: an easting alone fits every zone, so inferring one
// would fly somewhere plausible and wrong.
const MGA =
  /^(?:MGA\s*)?(?:zone\s*)?(5[456])\s*[C-HJ-NP-X]?\s*[,;]?\s*(\d{6}(?:\.\d+)?)\s*(?:m?E)?\s*[,;]?\s*(\d{7}(?:\.\d+)?)\s*(?:m?N)?$/i;

function parseMga(text: string): SearchPoint | null {
  const g = MGA.exec(text);
  if (!g) return null;
  const zone = Number(g[1]) as 54 | 55 | 56;
  const [easting, northing] = [Number(g[2]), Number(g[3])];
  const { lat, lon } = fromEastingNorthing(easting, northing, zone);
  if (!within(-lat, LAT_MAG) || !within(lon, LON_MAG)) return null;
  return { lat, lon, label: `MGA ${zone} ${easting} ${northing}` };
}

/** The point a typed string names, or null when it is not a coordinate. */
export function parseCoordinates(input: string): SearchPoint | null {
  const text = input.trim();
  return parseMga(text) ?? parseLatLon(text);
}

export const MAX_RECENT_SEARCHES = 6;

/** A place the user picked from the search box: enough to fly there again. */
export type RecentSearch = SearchPoint;

const sameRecent = (a: RecentSearch, b: RecentSearch) =>
  a.label === b.label &&
  a.lat.toFixed(5) === b.lat.toFixed(5) &&
  a.lon.toFixed(5) === b.lon.toFixed(5);

/** Newest first, the same pick once, at most MAX_RECENT_SEARCHES. */
export function addRecentSearch(
  list: readonly RecentSearch[],
  entry: RecentSearch,
): RecentSearch[] {
  return [entry, ...list.filter((r) => !sameRecent(r, entry))].slice(
    0,
    MAX_RECENT_SEARCHES,
  );
}

/** Whatever a client's store hands back, as a list; junk reads as empty. */
export function readRecentSearches(raw: unknown): RecentSearch[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (r): r is RecentSearch =>
        typeof r?.label === "string" &&
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lon),
    )
    .map(({ label, lat, lon }) => ({ label, lat, lon }))
    .slice(0, MAX_RECENT_SEARCHES);
}

/** Where the temporary pin for a searched location stands. */
export type SearchPin = Pick<SearchPoint, "lat" | "lon">;

/**
 * The pin after a map or search action. A picked point (a coordinate, a
 * registry or geocoder result, a recent) drops it exactly there; picking
 * anything else, a tap on the map, or emptying the box takes it away. Panning
 * and zooming are not events here: the user looks around the pin.
 */
export function searchPinAfter(
  event: "tap" | "clear" | { pick: SearchPoint | null },
): SearchPin | null {
  if (typeof event === "string" || !event.pick) return null;
  return { lat: event.pick.lat, lon: event.pick.lon };
}
