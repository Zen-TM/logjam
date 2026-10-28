import type { TBbox } from "../map/Map";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import { footprintOverlaps } from "./geoPdfOverlays";

/**
 * The vegetation archives a GeoPDF draws: the user's OWN completed jobs whose
 * footprint overlaps the extent, oldest first so newer ones land on top. Same
 * rule as the server's `api/src/services/generateGeoPdf.ts`. A job shared with
 * the user is never drawn: its vegetation is not theirs to print, only its
 * sharpened terrain is.
 */
export function vegetationUrlsFor(
  jobs: readonly CompletedTopoJob[],
  extent: TBbox,
): string[] {
  return jobs
    .filter((j) => j.syncRole === "owner" && footprintOverlaps(j, extent))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap(
      (j) => j.layers.find((l) => l.name === "vegetation")?.pmtilesUrl ?? [],
    );
}
