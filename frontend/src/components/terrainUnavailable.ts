import { t, type TerrainLayerKey } from "@logjam/shared";

// What the map says when a Terrain layer's map file can't be loaded. Whole
// messages, so a translator sees the sentence; terrainUnavailable.test.ts holds
// that each still names its layer as the contract does.
export const TERRAIN_UNAVAILABLE_MESSAGE: Record<TerrainLayerKey, string> = {
  contours: t`Contours couldn't be loaded — its map file is missing.`,
  land: t`Land tenure couldn't be loaded — its map file is missing.`,
  coverage: t`Coverage couldn't be loaded — its map file is missing.`,
  fire: t`Fire history couldn't be loaded — its map file is missing.`,
  slope: t`Slope couldn't be loaded — its map file is missing.`,
  hillshade: t`Hillshade couldn't be loaded — its map file is missing.`,
};

export const VEGETATION_UNAVAILABLE_MESSAGE = t`Vegetation couldn't be loaded for some sharpened areas — their map files are missing.`;
