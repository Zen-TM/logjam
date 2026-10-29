// Every network read of a GeoPDF render goes through here: one scheduler that
// starts the reads the earliest strip needs first, with a limit of reads in
// flight per host class, one retry, and an AbortSignal through every fetch.
//
// PRIVACY: a presigned URL is a bearer credential and a tile index is a
// coarse location. Nothing here logs, and an error carries a status or a kind,
// never a URL.
import {
  EtagMismatch,
  PMTiles,
  type RangeResponse,
  type Source,
} from "pmtiles";

/** Time one request, body included, may take. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Wait before the one retry (5xx, 429 or a network error). */
const RETRY_DELAY_MS = 250;

// Reads in flight at once, per host class. Declared once, here.
export const HOST_LIMITS = {
  // Same-origin statewide archives, behind CloudFront on HTTP/2: our own
  // distribution, and the live map already reads it like this. This counts
  // tile reads, and tiles stored side by side go out as one request
  // (`RangeSource`), so far fewer requests than this are ever in flight.
  // Chosen by timing an A3 1:25 000 print over a simulated link, 6 to 96:
  // at 100 Mbps and 150 ms the wait for tiles was 4.3 s at 6, 1.1 s at 24,
  // 0.8 s at 48 and 0.7 s at 96; at 10 Mbps and 100 ms it was 3.1 s at 24
  // and 48 and 3.7 s at 96, where the first strip's tiles queue behind the
  // rest. 48 is within 0.15 s of the best on both links.
  statewide: 48,
  // Presigned S3 archives (sharpened areas, vegetation): the user's own data
  // from our bucket, HTTP/1.1 keep-alive pools in browsers sit near this.
  presigned: 16,
  // A host without a published limit.
  other: 6,
} as const;

// Third-party base tiles, by hostname. No prefetch of any of these, ever: the
// reads are the tiles of the area the user asked to print.
const THIRD_PARTY_LIMITS: Record<string, number> = {
  // OSM Foundation tile usage policy (operations.osmfoundation.org/policies/tiles):
  // states no connection number but forbids bulk pre-emptive fetching and asks
  // for HTTP caching and a Referer, so a deliberately modest 4.
  "tile.openstreetmap.org": 4,
  // CyclOSM is served by OpenStreetMap France under "a fairuse tile policy"
  // that is the OSMF's above (cyclosm.org): the same 4.
  "a.tile-cyclosm.openstreetmap.fr": 4,
  // OpenTopoMap's about page (opentopomap.org/about) allows use "provided our
  // server is not overloaded by mass downloads" and gives no number: 2, as it
  // is a volunteer-run server.
  "a.tile.opentopomap.org": 2,
  // NSW Spatial Services web-service terms (spatial.nsw.gov.au, cl. 4.5) let
  // them cut off "excessive use" and set no number that we could read; the
  // default for a silent policy, in line with the live map's browser pool.
  "maps.six.nsw.gov.au": HOST_LIMITS.other,
};

/** The host class a URL belongs to: what the limit is counted over. */
export function hostClassOf(url: string, origin: string): string {
  if (url.startsWith(`${origin}/`)) return "statewide";
  const host = new URL(url).hostname;
  if (/\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) return "presigned";
  return host;
}

export function limitFor(hostClass: string): number {
  if (hostClass === "statewide") return HOST_LIMITS.statewide;
  if (hostClass === "presigned") return HOST_LIMITS.presigned;
  return THIRD_PARTY_LIMITS[hostClass] ?? HOST_LIMITS.other;
}

type Queued = {
  priority: number;
  seq: number;
  start: () => void;
  cancel: () => void;
};

/**
 * Runs tasks with `limit(hostClass)` in flight per class, lowest priority
 * number first (first in on a tie). A signal that aborts rejects every task
 * still waiting and starts none.
 */
export class Scheduler {
  private active = new Map<string, number>();
  private queues = new Map<string, Queued[]>();
  private seq = 0;
  /** Tasks asked for, and tasks that have finished either way. */
  scheduled = 0;
  settled = 0;
  /** Called after each task finishes. */
  onSettle: (() => void) | null = null;

  private signal: AbortSignal;
  private limit: (hostClass: string) => number;

  constructor(
    signal: AbortSignal,
    limit: (hostClass: string) => number = limitFor,
  ) {
    this.signal = signal;
    this.limit = limit;
    signal.addEventListener("abort", () => {
      for (const queue of this.queues.values()) {
        for (const q of queue.splice(0)) q.cancel();
      }
    });
  }

  run<T>(
    hostClass: string,
    priority: number,
    task: () => Promise<T>,
  ): Promise<T> {
    this.scheduled++;
    const result = new Promise<T>((resolve, reject) => {
      if (this.signal.aborted) {
        this.settled++;
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      const entry: Queued = {
        priority,
        seq: this.seq++,
        start: () => {
          this.active.set(hostClass, (this.active.get(hostClass) ?? 0) + 1);
          task()
            .then(resolve, reject)
            .finally(() => {
              this.active.set(hostClass, this.active.get(hostClass)! - 1);
              this.settled++;
              this.onSettle?.();
              this.pump(hostClass);
            });
        },
        cancel: () => {
          this.settled++;
          reject(new DOMException("aborted", "AbortError"));
        },
      };
      const queue = this.queues.get(hostClass) ?? [];
      this.queues.set(hostClass, queue);
      // Sorted insert: after every entry at or before this priority.
      let lo = 0;
      let hi = queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (queue[mid]!.priority <= priority) lo = mid + 1;
        else hi = mid;
      }
      queue.splice(lo, 0, entry);
      this.pump(hostClass);
    });
    // An abort rejects reads nobody is waiting for any more.
    result.catch(() => {});
    return result;
  }

  private pump(hostClass: string) {
    const queue = this.queues.get(hostClass);
    if (!queue) return;
    const limit = this.limit(hostClass);
    while (queue.length > 0 && (this.active.get(hostClass) ?? 0) < limit) {
      queue.shift()!.start();
    }
  }
}

export type Fetched = {
  status: number;
  bytes: ArrayBuffer;
  headers: Headers;
};

const aborted = () => new DOMException("aborted", "AbortError");

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(aborted());
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      done();
      reject(aborted());
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort);
  });
}

/** One request with its body, under the timeout and the caller's signal. */
async function attempt(
  url: string,
  headers: HeadersInit | undefined,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Fetched> {
  // No AbortSignal.any: iOS 16 has none.
  const own = new AbortController();
  const onAbort = () => own.abort();
  if (signal.aborted) throw aborted();
  signal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => own.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: own.signal });
    // A server that ignores Range answers 200 with the whole archive: never
    // read gigabytes to get a few kilobytes.
    const length = Number(res.headers.get("content-length"));
    if (
      maxBytes !== Infinity &&
      res.status === 200 &&
      (!length || length > maxBytes)
    ) {
      own.abort();
      throw new Error("response larger than asked");
    }
    return {
      status: res.status,
      bytes: await res.arrayBuffer(),
      headers: res.headers,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * GET `url` (with `range` if given), retrying once after 250 ms on a network
 * error, a 5xx or a 429. Resolves with the last response whatever its status;
 * rejects on a network error twice, or on abort.
 */
export async function fetchBytes(
  url: string,
  signal: AbortSignal,
  range?: { offset: number; length: number },
): Promise<Fetched> {
  const headers = range
    ? { range: `bytes=${range.offset}-${range.offset + range.length - 1}` }
    : undefined;
  const maxBytes = range ? range.length : Infinity;
  const retryable = (r: Fetched) => r.status >= 500 || r.status === 429;
  let first: Fetched | null = null;
  try {
    first = await attempt(url, headers, signal, maxBytes);
    if (!retryable(first)) return first;
  } catch {
    if (signal.aborted) throw aborted();
  }
  await pause(RETRY_DELAY_MS, signal);
  return attempt(url, headers, signal, maxBytes);
}

/**
 * The most one merged range read asks for. A clustered archive stores
 * neighbouring tiles side by side, so tiles read together are often one
 * contiguous run; this keeps one request from growing without end.
 */
export const MAX_MERGED_BYTES = 4 * 1024 * 1024;

type Wanted = {
  offset: number;
  length: number;
  resolve: (r: Fetched) => void;
  reject: (e: unknown) => void;
};

/**
 * A PMTiles source over `fetchBytes`: ranges, retry and abort as above.
 *
 * Reads asked for in the same tick that sit end to end in the archive go out
 * as one request, and the answer is cut back into the reads.
 */
class RangeSource implements Source {
  private url: string;
  private signal: AbortSignal;
  private wanted: Wanted[] = [];
  private flushing = false;
  constructor(url: string, signal: AbortSignal) {
    this.url = url;
    this.signal = signal;
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const res = await this.fetchMerged(offset, length, signal ?? this.signal);
    if (res.status >= 300) throw new Error(`Bad response code: ${res.status}`);
    // No If-Match is sent (CORS), so an archive replaced mid-render shows
    // only here. The library invalidates its header and tries again.
    const got = res.headers.get("etag");
    if (etag && got && !got.startsWith("W/") && got !== etag)
      throw new EtagMismatch("archive changed while it was read");
    return {
      data: res.bytes,
      etag: res.headers.get("etag") ?? undefined,
      cacheControl: res.headers.get("cache-control") ?? undefined,
      expires: res.headers.get("expires") ?? undefined,
    };
  }

  private fetchMerged(
    offset: number,
    length: number,
    signal: AbortSignal,
  ): Promise<Fetched> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(aborted());
      this.wanted.push({ offset, length, resolve, reject });
      if (this.flushing) return;
      this.flushing = true;
      // After the reads of this tick have all been asked for.
      setTimeout(() => this.flush(), 0);
    });
  }

  private flush() {
    const wanted = this.wanted.sort((a, b) => a.offset - b.offset);
    this.wanted = [];
    this.flushing = false;
    let run: Wanted[] = [];
    let end = -1;
    const send = () => {
      if (run.length > 0) this.send(run);
      run = [];
    };
    for (const w of wanted) {
      const total = run.length > 0 ? w.offset + w.length - run[0]!.offset : 0;
      if (w.offset !== end || total > MAX_MERGED_BYTES) send();
      run.push(w);
      end = w.offset + w.length;
    }
    send();
  }

  private send(run: Wanted[]) {
    if (run.length === 1) {
      const w = run[0]!;
      fetchBytes(this.url, this.signal, w).then(w.resolve, w.reject);
      return;
    }
    const start = run[0]!.offset;
    const last = run[run.length - 1]!;
    fetchBytes(this.url, this.signal, {
      offset: start,
      length: last.offset + last.length - start,
    }).then(
      (res) => {
        if (
          res.status >= 300 ||
          res.bytes.byteLength !== last.offset + last.length - start
        ) {
          // The merged read failed: ask for each on its own.
          for (const w of run)
            fetchBytes(this.url, this.signal, w).then(w.resolve, w.reject);
          return;
        }
        for (const w of run) {
          w.resolve({
            status: res.status,
            headers: res.headers,
            bytes: res.bytes.slice(
              w.offset - start,
              w.offset - start + w.length,
            ),
          });
        }
      },
      () => {
        for (const w of run)
          fetchBytes(this.url, this.signal, w).then(w.resolve, w.reject);
      },
    );
  }

  // Only used as a cache key inside this PMTiles instance.
  getKey() {
    return this.url;
  }
}

/** A PMTiles archive at `url`; one instance per archive per render. */
export function openArchive(url: string, signal: AbortSignal): PMTiles {
  return new PMTiles(new RangeSource(url, signal));
}

/** A tile fetched, or null where there is none (a miss or a failure). */
export type TileBytes = ArrayBuffer | null;

/** The reads of one render. */
export class TileFetcher {
  readonly scheduler: Scheduler;
  private signal: AbortSignal;
  private origin: string;
  constructor(signal: AbortSignal, origin: string) {
    this.signal = signal;
    this.origin = origin;
    this.scheduler = new Scheduler(signal);
  }

  /** An XYZ tile over HTTP: its bytes, or null after the retry has failed. */
  http(url: string, priority: number): Promise<TileBytes> {
    return this.scheduler.run(
      hostClassOf(url, this.origin),
      priority,
      async () => {
        try {
          const res = await fetchBytes(url, this.signal);
          return res.status === 200 ? res.bytes : null;
        } catch {
          if (this.signal.aborted) throw aborted();
          return null;
        }
      },
    );
  }

  /** A tile of a PMTiles archive: its bytes, or null for a miss or failure. */
  archive(
    archive: PMTiles,
    archiveUrl: string,
    z: number,
    x: number,
    y: number,
    priority: number,
  ): Promise<TileBytes> {
    return this.scheduler.run(
      hostClassOf(archiveUrl, this.origin),
      priority,
      async () => {
        try {
          const tile = await archive.getZxy(z, x, y, this.signal);
          return tile?.data ?? null;
        } catch {
          if (this.signal.aborted) throw aborted();
          return null;
        }
      },
    );
  }

  /** Whether the archive opens (its header reads), through the scheduler. */
  open(archive: PMTiles, archiveUrl: string): Promise<boolean> {
    return this.scheduler.run(
      hostClassOf(archiveUrl, this.origin),
      -2,
      async () => {
        try {
          await archive.getHeader();
          return true;
        } catch {
          if (this.signal.aborted) throw aborted();
          return false;
        }
      },
    );
  }
}
