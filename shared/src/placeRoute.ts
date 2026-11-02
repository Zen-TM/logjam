import { mediaCategory } from "./media.js";

/**
 * What fills a place's one route slot. A drawn route linked by `placeId` wins
 * over an attached track file (the slot is taken, so no file is offered);
 * Logjam Web and Logjam GPS both read the slot through here so neither can
 * say "No route yet" about a place the other shows a route for.
 */
export type PlaceRoute<R, M> =
  | { kind: "drawn"; route: R }
  | { kind: "file"; file: M };

export function placeRoute<
  R extends { placeId: string | null },
  M extends { mediaType: string },
>(
  placeId: string,
  routes: readonly R[],
  media: readonly M[],
): PlaceRoute<R, M> | null {
  const route = routes.find((r) => r.placeId === placeId);
  if (route) return { kind: "drawn", route };
  const file = media.find((m) => mediaCategory(m.mediaType) === "track");
  return file ? { kind: "file", file } : null;
}
