import type { TBbox } from "../map/Map";
import type { CompletedTopoJob } from "../../topoLayerTypes";

function* positions(c: unknown): Generator<[number, number]> {
  if (!Array.isArray(c)) return;
  if (typeof c[0] === "number") yield [c[0], c[1] as number];
  else for (const inner of c) yield* positions(inner);
}

/**
 * The vegetation archives a GeoPDF draws: the user's OWN completed jobs whose
 * footprint overlaps the extent (no footprint counts as overlapping), oldest
 * first so newer ones land on top. Same rule as the server's
 * `api/src/services/generateGeoPdf.ts`. A job shared with the user is never
 * drawn: its vegetation is not theirs to print, only its sharpened terrain is.
 */
export function vegetationUrlsFor(
  jobs: readonly CompletedTopoJob[],
  extent: TBbox,
): string[] {
  return jobs
    .filter((j) => j.syncRole === "owner")
    .filter((j) => {
      if (!j.footprint) return true;
      let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of positions(j.footprint.coordinates)) {
        w = Math.min(w, x);
        e = Math.max(e, x);
        s = Math.min(s, y);
        n = Math.max(n, y);
      }
      if (w > e) return true;
      return (
        e > extent.west &&
        w < extent.east &&
        n > extent.south &&
        s < extent.north
      );
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap(
      (j) => j.layers.find((l) => l.name === "vegetation")?.pmtilesUrl ?? [],
    );
}
