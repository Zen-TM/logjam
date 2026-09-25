// Which downloaded region, if any, can answer a snap query — the one decision
// that picks reading a local file over reading the CDN.
//
// Its own module (rather than sitting in snapLines.ts) purely so it is
// testable: snapLines pulls in expo-file-system and the app config, neither of
// which a unit test should have to stand up.
import { SNAP_TILE_ZOOM } from "@logjam/shared";

import type { MapArtifact } from "./sourceResolver";

/**
 * A downloaded Protomaps region containing BOTH ends of the segment.
 *
 * Both ends, not either: a region that holds one end has none of the ways
 * around the other, so the graph would be missing exactly the half that
 * matters and A* would refuse. Falling back to the network there is the honest
 * answer.
 */
export function regionCovering(
  artifacts: readonly MapArtifact[],
  from: [number, number],
  to: [number, number],
): MapArtifact | null {
  return (
    artifacts.find((artifact) => {
      if (artifact.kind !== "basemap-region" || artifact.format !== "pmtiles") {
        return false;
      }
      // The download screen's detail rail can clip a region short of z15, and
      // snapping reads one fixed zoom. A shallower region would answer "no
      // ways here" rather than "I don't have that" — silently worse than the
      // network, so it doesn't get to answer.
      if ((artifact.maxzoom ?? 0) < SNAP_TILE_ZOOM) return false;
      const bbox = artifact.bbox;
      if (!bbox) return false;
      const [west, south, east, north] = bbox;
      return [from, to].every(
        ([lon, lat]) =>
          lon >= west && lon <= east && lat >= south && lat <= north,
      );
    }) ?? null
  );
}

