import {
  MAP_TERRAIN,
  takesNswContours,
  takesNswHillshade,
  type TerrainLayerKey,
} from "@logjam/shared";
import { unavailableReasonText } from "../auth/capabilities";
import {
  holdsContours,
  holdsHillshade,
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
 * One Terrain switch on the layers sheet. The basemap's reason (a sheet that
 * prints its own contours, photographs with their own shadows) outranks the
 * connection's, and only it reads OFF: a stored choice comes back on a basemap
 * that can draw it. With no connection a layer needs a saved clip of itself.
 * Guard: `terrainSwitches.test.ts`.
 */
export function terrainSwitch(
  key: TerrainLayerKey,
  stored: boolean,
  basemapId: BasemapId,
  online: boolean,
  artifacts: readonly Pick<MapArtifact, "kind" | "logicalKey" | "minzoom">[],
): TerrainSwitchState {
  const copy = MAP_TERRAIN.copy;
  if (key === "contours" && !takesNswContours(basemapId)) {
    return { checked: false, disabled: true, reason: copy.contoursPrinted };
  }
  if (key === "hillshade" && !takesNswHillshade(basemapId)) {
    return { checked: false, disabled: true, reason: copy.hillshadeImagery };
  }
  const saved = artifacts.some(
    key === "contours"
      ? holdsContours
      : key === "slope"
        ? holdsSlope
        : holdsHillshade,
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
