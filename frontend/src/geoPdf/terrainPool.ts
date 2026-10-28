// A few helper workers for the terrain pixel work, which is most of a warm
// render: each strip's hillshade and slope are cut into bands of map rows
// (terrainJobs.ts) and the bands run side by side. The render worker takes a
// band itself, so a pool of n helpers does n + 1 at once.
//
// No pool is a working state: a browser that will not start a worker from a
// worker, a single core, or a helper that fails, and the band runs here
// instead. Ending the render worker ends its helpers.
import { runTerrainBand, type TerrainBand } from "./terrainJobs";

/** Helpers beyond this add copying more than they take off. */
const MAX_HELPERS = 3;

/** Helpers worth starting on this device: one core left for the render worker and the browser. */
export function helperCount(): number {
  const cores =
    typeof navigator === "undefined" ? 1 : navigator.hardwareConcurrency || 1;
  return Math.max(0, Math.min(MAX_HELPERS, cores - 2));
}

type Pending = {
  band: TerrainBand;
  resolve: (rgba: Uint8ClampedArray) => void;
};

export class TerrainPool {
  private helpers: Worker[] = [];
  private pending = new Map<number, Pending>();
  private next = 0;

  constructor(count: number = helperCount()) {
    for (let i = 0; i < count; i++) {
      try {
        const worker = new Worker(
          new URL("./terrain.worker.ts", import.meta.url),
          {
            type: "module",
          },
        );
        worker.onmessage = (
          e: MessageEvent<{ id: number; rgba: Uint8ClampedArray }>,
        ) => {
          const job = this.pending.get(e.data.id);
          this.pending.delete(e.data.id);
          job?.resolve(e.data.rgba);
        };
        // A helper that fails hands its band back to be done here.
        worker.onerror = () => this.fallBack(worker);
        this.helpers.push(worker);
      } catch {
        break;
      }
    }
  }

  /** How many bands to cut a strip into. */
  get width(): number {
    return this.helpers.length + 1;
  }

  /** Run `bands` (at most `width` of them) side by side: RGBA for each, in order. */
  run(bands: TerrainBand[]): Promise<Uint8ClampedArray[]> {
    return Promise.all(
      bands.map((band, i) => {
        // The first band is done here, while the helpers do the rest.
        if (i === 0 || this.helpers.length === 0) {
          return new Promise<Uint8ClampedArray>((resolve) =>
            setTimeout(() => resolve(runTerrainBand(band)), 0),
          );
        }
        const worker = this.helpers[(i - 1) % this.helpers.length]!;
        return new Promise<Uint8ClampedArray>((resolve) => {
          const id = this.next++;
          this.pending.set(id, { band, resolve });
          try {
            worker.postMessage({ id, band });
          } catch {
            this.pending.delete(id);
            resolve(runTerrainBand(band));
          }
        });
      }),
    );
  }

  private fallBack(worker: Worker) {
    this.helpers = this.helpers.filter((w) => w !== worker);
    worker.terminate();
    // Whatever it held is lost with it: redo that here.
    for (const [id, job] of this.pending) {
      this.pending.delete(id);
      job.resolve(runTerrainBand(job.band));
    }
  }

  terminate() {
    for (const w of this.helpers) w.terminate();
    this.helpers = [];
  }
}
