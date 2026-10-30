// A helper of the terrain pool (terrainPool.ts): decodes the tiles and paints
// the bands it is sent, one at a time, nothing else. Between jobs it keeps
// only what it reuses: one paint buffer for the bands (`runTerrainBand`'s
// `reuse`) and one tile-sized canvas for the decodes. A band that throws does so here, synchronously, so the pool hears it
// as the worker's error event; a decode never throws (it answers null).
import { decodeTerrainTile, runTerrainBand } from "./terrainJobs";
import type { TerrainJob } from "./terrainPool";

const scope = self as unknown as {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage:
    | ((e: MessageEvent<{ job: TerrainJob; fail?: boolean }>) => void)
    | null;
};

const answer = (result: Uint8ClampedArray | Float32Array | null) =>
  scope.postMessage({ result }, result ? [result.buffer] : []);

scope.onmessage = (e) => {
  if (e.data.fail) throw new Error("helper failed (test hook)");
  const { job } = e.data;
  if (job.kind === "band") answer(runTerrainBand(job.band, true));
  else void decodeTerrainTile(job.bytes).then(answer);
};
