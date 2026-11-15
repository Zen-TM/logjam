import {
  coverageCarrierHere,
  drawsCoverage,
  drawsNswContours,
  drawsNswHillshade,
  type CarrierId,
  type Region,
  type TerrainLayerKey,
} from "@logjam/shared";

/**
 * Which Terrain layers the map draws over `region`, and the carrier its
 * Coverage layer draws and filters by: the stored `carrier` where `region`
 * lists it, else none, so a region that does not list it draws no Coverage.
 * Guard: `terrainDrawn.test.ts`.
 */
export function terrainDrawn(
  layers: Readonly<Record<TerrainLayerKey, boolean>>,
  activeLayerId: string,
  region: Region | null,
  carrier: CarrierId | null,
): { shown: Record<TerrainLayerKey, boolean>; carrier: CarrierId | null } {
  const carrierHere = coverageCarrierHere(region, carrier);
  return {
    carrier: carrierHere,
    shown: {
      contours: drawsNswContours(activeLayerId, layers.contours),
      coverage: drawsCoverage(layers.coverage, carrierHere),
      fire: layers.fire,
      slope: layers.slope,
      land: layers.land,
      hillshade: drawsNswHillshade(activeLayerId, layers.hillshade),
    },
  };
}
