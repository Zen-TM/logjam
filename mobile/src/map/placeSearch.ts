// Where the map's search box finds locations as the user types, and the order
// its rows come in. Free of React Native, so both have a test
// (placeSearch.test.ts).
//
// The place registry on this phone answers whenever it is here, even online:
// it is instant and nothing typed leaves the phone (ADR 0034). A signed-in
// phone without it asks our API, which runs the same `searchPlaces`; a guest
// has no API (ADR 0007), so it gets only its own places and the explicit
// Nominatim row.
//
// PRIVACY: the typed text goes in a POST body, never a URL, and never into a
// log line. Guard: src/sentry/scrubEvent.test.ts ("the typed search query").
import {
  PLACE_SEARCH_API_PATH,
  type PlaceResult,
  type PlaceSearchRequest,
  type PlaceSearchResponse,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { capabilityStatus, type AccountState } from "../auth/capabilities";

/** Registry results shown at once: past this the "Search locations for …"
 *  row under them is a scroll away. */
export const MAX_PLACE_RESULTS = 8;

export type PlaceSearchSource = "device" | "api" | "none";

export function placeSearchSource(
  hasRegistry: boolean,
  accountState: AccountState,
  online: boolean,
): PlaceSearchSource {
  if (hasRegistry) return "device";
  return capabilityStatus("placeSearch", accountState, online).status ===
    "available"
    ? "api"
    : "none";
}

export async function searchPlacesOnline(
  q: string,
  signal: AbortSignal,
): Promise<PlaceResult[]> {
  const body: PlaceSearchRequest = { q, limit: MAX_PLACE_RESULTS };
  const response = await apiFetch<PlaceSearchResponse>(PLACE_SEARCH_API_PATH, {
    method: "POST",
    body,
    signal,
  });
  return response.results;
}

export type SearchRow<Saved> =
  | { kind: "saved"; item: Saved }
  | { kind: "place"; place: PlaceResult }
  /** The ODbL credit, under the registry's results. */
  | { kind: "credit" }
  /** "Search locations for …", which asks Nominatim. */
  | { kind: "ask" };

/** The user's own things, then the registry's, its credit, then the ask. */
export function searchRows<Saved>(
  saved: readonly Saved[],
  places: readonly PlaceResult[],
  offerAsk: boolean,
): SearchRow<Saved>[] {
  return [
    ...saved.map((item) => ({ kind: "saved" as const, item })),
    ...places.map((place) => ({ kind: "place" as const, place })),
    ...(places.length > 0 ? [{ kind: "credit" as const }] : []),
    ...(offerAsk ? [{ kind: "ask" as const }] : []),
  ];
}
