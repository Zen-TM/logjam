// External place-name geocoder for the map-pick flows (place location, topo /
// GeoPDF extent). Used only to help the user recentre the map on a place they
// type — e.g. "Newnes Plateau".
//
// PRIVACY: the only thing sent to the external service (OpenStreetMap Nominatim)
// is the user-typed place string. No place names, coordinates, or account data
// ever leave the app through this path (geocode.test.ts). It goes only when
// the user asks (shared/DESIGN.md §13): Nominatim's usage policy forbids
// search-as-you-type on its API. Results bias toward NSW, Australia.

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Bias toward NSW, Australia (the canyoning region) without hard-restricting:
// lon1,lat1,lon2,lat2 (two opposite corners).
const NSW_VIEWBOX = "140.999,-28.157,153.638,-37.505";

/** Shorter than this, the geocoder has nothing useful to say. */
export const GEOCODE_MIN_QUERY_LENGTH = 3;
const RESULT_LIMIT = 5;

/** The one sentence both clients offer for asking the geocoder. */
export function searchLocationsLabel(query: string): string {
  return `Search locations for “${query.trim()}”`;
}

// Nominatim allows one request a second per APPLICATION. A client can only
// hold itself to that, so each one spaces its own requests a second apart;
// across all users it holds only because a search is a press, not a keystroke.
// ponytail: per-client spacing; proxy through the API (one queue, one cache,
// and no user IP at OSM) if usage ever grows.
const MIN_INTERVAL_MS = 1000;
let nextSlotAt = 0;

function waitForSlot(signal?: AbortSignal): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlotAt);
  nextSlotAt = at + MIN_INTERVAL_MS;
  if (at === now) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, at - now);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// The policy also blocks clients that repeat a query, so an answer is kept for
// the session. Small: it serves a user searching the same name twice.
const CACHE_LIMIT = 20;
const answers = new Map<string, GeocodeResult[]>();

export async function geocode(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < GEOCODE_MIN_QUERY_LENGTH) return [];
  const cached = answers.get(trimmed.toLowerCase());
  if (cached) return cached;
  await waitForSlot(signal);

  const params = new URLSearchParams({
    format: "jsonv2",
    q: trimmed,
    countrycodes: "au",
    limit: String(RESULT_LIMIT),
    viewbox: NSW_VIEWBOX,
    bounded: "0",
  });

  // Raw fetch, not apiFetch: this is a third-party host with no app auth or
  // base URL — apiFetch would inject the wrong origin and our credentials.
  //
  // User-Agent is required by the Nominatim usage policy: it 403s generic
  // library agents, which is what React Native sends on Android (okhttp/...).
  // Browsers treat User-Agent as a forbidden header and drop it before the
  // request (and before preflight computation), so setting it is a no-op there.
  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    signal,
    headers: {
      Accept: "application/json",
      "User-Agent": "Logjam/0.1.0 (https://logjamnsw.com)",
    },
  });
  if (!res.ok) throw new Error(`Geocoder returned ${res.status}`);

  const data = (await res.json()) as Array<{
    display_name?: unknown;
    lat?: unknown;
    lon?: unknown;
  }>;
  const results = data
    .map((d) => ({
      displayName: typeof d.display_name === "string" ? d.display_name : "",
      lat: Number(d.lat),
      lon: Number(d.lon),
    }))
    .filter(
      (r) =>
        r.displayName !== "" &&
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lon),
    );
  if (answers.size >= CACHE_LIMIT) {
    answers.delete(answers.keys().next().value!);
  }
  answers.set(trimmed.toLowerCase(), results);
  return results;
}
