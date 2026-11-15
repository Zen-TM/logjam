import {
  layerIn,
  MAP_TERRAIN,
  normalizeCarrier,
  takesContours,
  takesHillshade,
  type CarrierId,
  type Region,
  type TerrainLayerKey,
} from "@logjam/shared";
import { unavailableReasonText } from "../auth/capabilities";
import {
  holdsContours,
  holdsCoverage,
  holdsFire,
  holdsHillshade,
  holdsLand,
  holdsSlope,
  type BasemapId,
  type MapArtifact,
} from "./sourceResolver";

export type TerrainSwitchState = {
  /** What the switch shows: off while nothing can draw the layer. */
  checked: boolean;
  disabled: boolean;
  /** One plain sentence under the title, when the switch is disabled. */
  reason?: string;
};

/**
 * One Terrain switch on the layers sheet. A region with no archive for the
 * layer (`layerIn`) outranks the basemap's reason (a sheet that prints its own
 * contours, photographs with their own shadows), which outranks the
 * connection's. Both read OFF: a stored choice comes back on ground and a
 * basemap that can draw it. With no connection a layer needs a saved clip of
 * itself. Guard: `terrainSwitches.test.ts`.
 */
export function terrainSwitch(
  key: TerrainLayerKey,
  stored: boolean,
  basemapId: BasemapId,
  online: boolean,
  artifacts: readonly Pick<MapArtifact, "kind" | "logicalKey" | "minzoom">[],
  region: Region | null,
): TerrainSwitchState {
  const copy = MAP_TERRAIN.copy;
  if (layerIn(region, key) === null) {
    return { checked: false, disabled: true, reason: copy.notHere };
  }
  if (key === "contours" && !takesContours(basemapId)) {
    return { checked: false, disabled: true, reason: copy.contoursPrinted };
  }
  if (key === "hillshade" && !takesHillshade(basemapId)) {
    return { checked: false, disabled: true, reason: copy.hillshadeImagery };
  }
  const saved = artifacts.some((artifact) =>
    key === "contours"
      ? holdsContours(artifact)
      : key === "slope"
        ? holdsSlope(artifact)
        : key === "land"
          ? holdsLand(artifact)
          : key === "fire"
            ? holdsFire(artifact)
            : key === "coverage"
              ? holdsCoverage(artifact)
              : holdsHillshade(artifact),
  );
  if (!online && !saved) {
    return {
      checked: stored,
      disabled: true,
      reason: unavailableReasonText("needs-connection"),
    };
  }
  return { checked: stored, disabled: false };
}

/**
 * The carrier the Coverage row names for the region in view: the stored pick
 * where that region lists it, else none, so the row asks again. Guard:
 * `terrainSwitches.test.ts`.
 */
export function coverageCarrierHere(
  region: Region | null,
  stored: CarrierId | null,
): CarrierId | null {
  return normalizeCarrier(stored, layerIn(region, "coverage")?.carriers ?? []);
}

/** Whether the region in view has a gauge feed, which the Gauges row needs. */
export function hasGauges(region: Region | null): boolean {
  return region?.gauges != null;
}
