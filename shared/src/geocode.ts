// External place-name geocoder for the map-pick flows (canyon location, topo /
// GeoPDF extent). Used only to help the user recentre the map on a place they
// type — e.g. "Newnes Plateau".
//
// PRIVACY: the only thing sent to the external service (OpenStreetMap Nominatim)
// is the user-typed place string. No canyon names, coordinates, or account data
// ever leave the app through this path. Results bias toward NSW, Australia.

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Bias toward NSW, Australia (the canyoning region) without hard-restricting:
// lon1,lat1,lon2,lat2 (two opposite corners).
const NSW_VIEWBOX = "140.999,-28.157,153.638,-37.505";

const MIN_QUERY_LENGTH = 3;
const RESULT_LIMIT = 5;

export async function geocode(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

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
  return data
    .map((d) => ({
      displayName: typeof d.display_name === "string" ? d.display_name : "",
      lat: Number(d.lat),
      lon: Number(d.lon),
    }))
    .filter(
      (r) => r.displayName !== "" && Number.isFinite(r.lat) && Number.isFinite(r.lon),
    );
}
