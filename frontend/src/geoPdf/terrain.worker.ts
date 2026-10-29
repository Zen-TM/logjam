// A helper of the terrain pool (terrainPool.ts): paints and resamples the
// bands it is sent, nothing else. It holds no tiles and no canvas.
import { runTerrainBand, type TerrainBand } from "./terrainJobs";

const scope = self as unknown as {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage:
    | ((
        e: MessageEvent<{ id: number; band: TerrainBand; fail?: boolean }>,
      ) => void)
    | null;
};

scope.onmessage = (e) => {
  if (e.data.fail) throw new Error("helper failed (test hook)");
  const rgba = runTerrainBand(e.data.band);
  scope.postMessage({ id: e.data.id, rgba }, [rgba.buffer]);
};
