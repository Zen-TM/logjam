// A helper of the terrain pool (terrainPool.ts): paints and resamples the
// bands it is sent, nothing else. It holds no tiles and no canvas.
import { runTerrainBand, type TerrainBand } from "./terrainJobs";

const scope = self as unknown as {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage:
    | ((e: MessageEvent<{ id: number; band: TerrainBand }>) => void)
    | null;
};

scope.onmessage = (e) => {
  const rgba = runTerrainBand(e.data.band);
  scope.postMessage({ id: e.data.id, rgba }, [rgba.buffer]);
};
