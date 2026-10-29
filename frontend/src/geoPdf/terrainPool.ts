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
  worker: Worker;
  band: TerrainBand;
  resolve: (rgba: Uint8ClampedArray) => void;
  reject: (e: unknown) => void;
};

export type PoolOptions = {
  /** Helpers to start; default `helperCount()`. */
  count?: number;
  /** Test hook: the first helper throws on its first band. */
  failFirst?: boolean;
};

export class TerrainPool {
  private helpers: Worker[] = [];
  private pending = new Map<number, Pending>();
  private next = 0;
  /** Bands a helper drew (not redone here): what a test checks the pool did. */
  helperBands = 0;

  constructor({ count = helperCount(), failFirst = false }: PoolOptions = {}) {
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
          if (job) {
            this.helperBands++;
            job.resolve(e.data.rgba);
          }
        };
        // A helper that fails hands its bands back to be done here. The
        // error is cancelable: left alone it would reach the render worker's
        // own scope and fail the whole render (guard: terrainPool.test.ts,
        // and the "helper fails" case in e2e/geopdf-render.spec.ts).
        worker.onerror = (e) => {
          e.preventDefault();
          this.fallBack(worker);
        };
        worker.onmessageerror = () => this.fallBack(worker);
        (worker as Worker & { fail?: boolean }).fail = failFirst && i === 0;
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
          return new Promise<Uint8ClampedArray>((resolve, reject) =>
            setTimeout(() => {
              try {
                resolve(runTerrainBand(band));
              } catch (e) {
                reject(e);
              }
            }, 0),
          );
        }
        const worker = this.helpers[(i - 1) % this.helpers.length]!;
        return new Promise<Uint8ClampedArray>((resolve, reject) => {
          const id = this.next++;
          this.pending.set(id, { worker, band, resolve, reject });
          try {
            const w = worker as Worker & { fail?: boolean };
            worker.postMessage({ id, band, fail: w.fail });
            w.fail = false;
          } catch {
            this.pending.delete(id);
            this.redo(band, resolve, reject);
          }
        });
      }),
    );
  }

  private redo(
    band: TerrainBand,
    resolve: (rgba: Uint8ClampedArray) => void,
    reject: (e: unknown) => void,
  ) {
    try {
      resolve(runTerrainBand(band));
    } catch (e) {
      reject(e);
    }
  }

  private fallBack(worker: Worker) {
    this.helpers = this.helpers.filter((w) => w !== worker);
    worker.terminate();
    // What this helper held is lost with it: redo just that here.
    for (const [id, job] of this.pending) {
      if (job.worker !== worker) continue;
      this.pending.delete(id);
      this.redo(job.band, job.resolve, job.reject);
    }
  }

  terminate() {
    for (const w of this.helpers) w.terminate();
    this.helpers = [];
  }
}
