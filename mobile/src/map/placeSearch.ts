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
// log line. Guards: placeSearch.test.ts ("sends the query in the body, never
// the URL"), src/sentry/scrubEvent.test.ts ("the typed search query").
import {
  messageFromError,
  PLACE_SEARCH_API_PATH,
  PLACE_SEARCH_DEBOUNCE_MS,
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

/** The API's answer, tagged with the query it answers. */
export type PlaceAnswer = {
  query: string;
  results: PlaceResult[];
  error: string | null;
};

/**
 * Ask the API about `query` once the user pauses. `settle` hears this query's
 * answer only until the returned cancel runs, which aborts the request.
 */
export function askPlacesOnline(
  query: string,
  settle: (answer: PlaceAnswer) => void,
): () => void {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    searchPlacesOnline(query, controller.signal)
      .then((results) => {
        // An abort after the response arrived does not reject.
        if (!controller.signal.aborted) {
          settle({ query, results, error: null });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // The error carries the path, never the body.
        console.error(err);
        settle({
          query,
          results: [],
          error: messageFromError(err, "Couldn't search locations."),
        });
      });
  }, PLACE_SEARCH_DEBOUNCE_MS);
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}

/** What the box shows for the API's answer: it still fits while the query only
 *  grows ("Kat" while typing "Kato"); otherwise the next answer is awaited. */
export function placesFromAnswer(
  answer: PlaceAnswer | null,
  query: string,
): readonly PlaceResult[] | PlacesPending {
  if (!answer || !query.startsWith(answer.query)) return "loading";
  return answer.error === null ? answer.results : { error: answer.error };
}

/** In place of the registry's results: still loading, or why there are none. */
export type PlacesPending =
  | "loading"
  /** `retry` when pressing Try again can help. */
  | { error: string; retry?: () => void };

export type SearchRow<Saved> =
  | { kind: "saved"; item: Saved }
  | { kind: "place"; place: PlaceResult }
  /** In place of the registry's results while they load. */
  | { kind: "loading" }
  /** In place of the registry's results: why there are none. */
  | { kind: "error"; message: string; retry?: () => void }
  /** The ODbL credit, under the registry's results. */
  | { kind: "credit" }
  /** "Search locations for …", which asks Nominatim. */
  | { kind: "ask" };

/** The user's own things, then the registry's, its credit, then the ask. */
export function searchRows<Saved>(
  saved: readonly Saved[],
  places: readonly PlaceResult[] | PlacesPending,
  offerAsk: boolean,
): SearchRow<Saved>[] {
  if (!Array.isArray(places)) {
    const pending = places as PlacesPending;
    return [
      ...saved.map((item) => ({ kind: "saved" as const, item })),
      pending === "loading"
        ? { kind: "loading" as const }
        : {
            kind: "error" as const,
            message: pending.error,
            retry: pending.retry,
          },
      ...(offerAsk ? [{ kind: "ask" as const }] : []),
    ];
  }
  return [
    ...saved.map((item) => ({ kind: "saved" as const, item })),
    ...places.map((place) => ({ kind: "place" as const, place })),
    ...(places.length > 0 ? [{ kind: "credit" as const }] : []),
    ...(offerAsk ? [{ kind: "ask" as const }] : []),
  ];
}
