// Helper workers for the terrain work, which is most of a warm render: they
// decode a strip's height and slope tiles and paint its hillshade and slope in
// bands of map rows (terrainJobs.ts) while the render worker draws the base
// tiles. Jobs wait in one queue and a helper takes the next when it is free,
// so a phone's slow cores take fewer bands than its fast ones.
//
// No pool is a working state: a browser that will not start a worker from a
// worker, a single core, or a helper that fails, and the job runs here
// instead. Ending the render worker ends its helpers.
import {
  decodeTerrainTile,
  runTerrainBand,
  type TerrainBand,
} from "./terrainJobs";

/** Past this, a helper adds start-up and memory more than speed. */
const MAX_HELPERS = 7;

/** Helpers worth starting on this device: one core left for the render worker. */
export function helperCount(): number {
  const cores =
    typeof navigator === "undefined" ? 1 : navigator.hardwareConcurrency || 1;
  return Math.max(0, Math.min(MAX_HELPERS, cores - 1));
}

/** What a helper is asked to do. */
export type TerrainJob =
  | { kind: "band"; band: TerrainBand }
  | { kind: "decode"; bytes: ArrayBuffer };

type Result = Uint8ClampedArray | Float32Array | null;

type Queued = {
  job: TerrainJob;
  resolve: (r: Result) => void;
  reject: (e: unknown) => void;
};

export type PoolOptions = {
  /** Helpers to start; default `helperCount()`. */
  count?: number;
  /** Test hook: the first helper throws on its first job. */
  failFirst?: boolean;
};

/** A job done on this thread, as a helper would do it. */
const runHere = (job: TerrainJob): Result | Promise<Result> =>
  job.kind === "band" ? runTerrainBand(job.band) : decodeTerrainTile(job.bytes);

export class TerrainPool {
  private helpers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Queued[] = [];
  private running = new Map<Worker, Queued>();
  private failNext = new Set<Worker>();
  private hereBusy = false;
  /** Bands a helper drew (not redone here): what a test checks the pool did. */
  helperBands = 0;

  constructor({ count = helperCount(), failFirst = false }: PoolOptions = {}) {
    for (let i = 0; i < count; i++) {
      let worker: Worker;
      try {
        worker = new Worker(new URL("./terrain.worker.ts", import.meta.url), {
          type: "module",
        });
      } catch {
        break;
      }
      worker.onmessage = (e: MessageEvent<{ result: Result }>) => {
        const done = this.running.get(worker);
        this.running.delete(worker);
        this.idle.push(worker);
        if (done) {
          if (done.job.kind === "band") this.helperBands++;
          done.resolve(e.data.result);
        }
        this.pump();
      };
      // A helper that fails hands its job back. The error is cancelable:
      // left alone it would reach the render worker's own scope and fail the
      // whole render (guard: terrainPool.test.ts, and the "helper fails" case
      // in e2e/geopdf-render.spec.ts).
      worker.onerror = (e) => {
        e.preventDefault();
        this.fallBack(worker);
      };
      worker.onmessageerror = () => this.fallBack(worker);
      if (failFirst && i === 0) this.failNext.add(worker);
      this.helpers.push(worker);
      this.idle.push(worker);
    }
  }

  /** Helpers running. */
  get size(): number {
    return this.helpers.length;
  }

  band(band: TerrainBand): Promise<Uint8ClampedArray> {
    return this.add({ kind: "band", band }) as Promise<Uint8ClampedArray>;
  }

  decode(bytes: ArrayBuffer): Promise<Float32Array | null> {
    return this.add({ kind: "decode", bytes }) as Promise<Float32Array | null>;
  }

  private add(job: TerrainJob): Promise<Result> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const next = this.queue.shift()!;
      this.running.set(worker, next);
      try {
        this.post(worker, next.job);
      } catch {
        this.fallBack(worker);
      }
    }
    if (this.helpers.length === 0 && this.queue.length > 0) this.runQueueHere();
  }

  private post(worker: Worker, job: TerrainJob) {
    const fail = this.failNext.delete(worker);
    if (job.kind === "decode") {
      // Copied, not moved: the tile cache may still be writing these bytes.
      worker.postMessage({ job, fail });
      return;
    }
    // A band's values are a view of the strip's grid: the helper gets a copy
    // of just those rows, moved rather than copied again.
    const values = job.band.values.slice();
    worker.postMessage(
      { job: { kind: "band", band: { ...job.band, values } }, fail },
      [values.buffer],
    );
  }

  /** With no helper, the queue runs here, a job a task, so other work interleaves. */
  private runQueueHere() {
    if (this.hereBusy) return;
    this.hereBusy = true;
    setTimeout(async () => {
      const next = this.queue.shift();
      if (next) {
        try {
          next.resolve(await runHere(next.job));
        } catch (e) {
          next.reject(e);
        }
      }
      this.hereBusy = false;
      if (this.queue.length > 0) this.runQueueHere();
    }, 0);
  }

  private fallBack(worker: Worker) {
    this.helpers = this.helpers.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);
    worker.terminate();
    // What this helper held goes back to the front of the queue, for another
    // helper or, with none left, this thread.
    const held = this.running.get(worker);
    this.running.delete(worker);
    if (held) this.queue.unshift(held);
    this.pump();
  }

  terminate() {
    for (const w of this.helpers) w.terminate();
    this.helpers = [];
    this.idle = [];
    this.queue = [];
  }
}
