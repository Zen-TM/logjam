// External place-name geocoder for the map-pick flows (place location, topo /
// GeoPDF extent). Used only to help the user recentre the map on a place they
// type — e.g. "Newnes Plateau".
//
// PRIVACY: what goes to the external service (OpenStreetMap Nominatim) is the
// user-typed place string and, when the map shows a region, that region's
// whole bounds so its places rank first. The bounds are the same for everyone
// looking at that region: the map's own view, centre and zoom never leave the
// device, and outside every region nothing about the view is sent. No place
// names, coordinates, or account data go through this path (geocode.test.ts).
// It goes only when the user asks (shared/DESIGN.md §13): Nominatim's usage
// policy forbids search-as-you-type on its API.

import {
  regionBounds,
  regionInView,
  REGIONS,
  WORLD,
  type LonLatBox,
  type Region,
} from "./regions.js";

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/**
 * The box to bias a search by: the bounds of the region the map shows, or
 * null outside every region (and for the worldwide entry, which has no
 * border). Never the view itself. Guard: geocode.test.ts ("is the bounds of
 * the region in view and nothing outside every region").
 */
export function geocodeBias(
  view: LonLatBox | null | undefined,
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): LonLatBox | null {
  const region = view ? regionInView(view, regions, world) : null;
  return region && region.borders.length > 0 ? regionBounds(region) : null;
}

// Nominatim's viewbox is lon1,lat1,lon2,lat2 (two opposite corners); with
// bounded=0 it ranks by it without restricting.
const viewbox = ({ west, south, east, north }: LonLatBox) =>
  `${west},${north},${east},${south}`;

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

/** `view` is what the map shows: it picks the bias (geocodeBias) and is never sent. */
export async function geocode(
  query: string,
  signal?: AbortSignal,
  view?: LonLatBox | null,
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < GEOCODE_MIN_QUERY_LENGTH) return [];
  const bias = geocodeBias(view);
  // The bias is part of the key: the same name asked from another region has
  // another answer.
  const key = `${trimmed.toLowerCase()}|${bias ? viewbox(bias) : ""}`;
  const cached = answers.get(key);
  if (cached) return cached;
  await waitForSlot(signal);

  const params = new URLSearchParams({
    format: "jsonv2",
    q: trimmed,
    limit: String(RESULT_LIMIT),
    ...(bias ? { viewbox: viewbox(bias), bounded: "0" } : {}),
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
      "User-Agent": "Logjam/0.1.0 (https://logjam.earth)",
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
  answers.set(key, results);
  return results;
}
