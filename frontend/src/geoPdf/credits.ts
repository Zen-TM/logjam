import type { SharpenedArea, TerrainLayerKey } from "@logjam/shared";
import { terrainCreditLines } from "./terrain";

/**
 * The most terrain credit lines a render can print: every requested layer
 * drew, and every area on the page supplied all of them. The attribution is
 * only known once the last tile has settled, so the strips under its block
 * wait for that; this bound finds which strips those are. The real block is
 * never taller. Guard: credits.test.ts.
 */
export function upperBoundTerrainLines(
  requested: ReadonlySet<TerrainLayerKey>,
  areas: readonly SharpenedArea[],
): string[] {
  const upperAreas = new Map(
    areas.map((a) => [a, new Set(requested)] as const),
  );
  return terrainCreditLines(requested, upperAreas);
}
