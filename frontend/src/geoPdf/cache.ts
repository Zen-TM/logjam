// A tile cache that outlives the tab, for the statewide archives only: a
// repeat print of the same area starts warm.
//
// PRIVACY: what is cached is the tiles of the area a user printed, so it is
// their data. It holds nothing but same-origin statewide archive ranges
// (`cacheableArchive` in tiles.ts decides, and is the only way in), it is
// cleared on every sign-out (`clearTileCache`, called from useAuth.ts and
// RootErrorBoundary.tsx; guards: useAuth.test.tsx, RootErrorBoundary.test.tsx,
// cache.test.ts), and a presigned or third-party URL never reaches it
// (guard: tiles.test.ts). Nothing here logs.
//
// Shape: the Cache API holds the bytes, one synthetic 200 response per byte
// range read (it cannot store the 206 a range read returns), under a made-up
// URL that is never fetched. An index of sizes and last use decides what
// goes when the budget is passed, least recently used first. The index lives
// in the same cache as one more entry, so one `caches.delete` clears all of
// it, and every entry carries its own size and last use in headers so a
// lost index is rebuilt rather than leaking bytes. Every storage call is in a
// try/catch: with no storage (a private window, a quota error) the cache is
// simply never there, and a render works without it.

/** 200 MB: about forty A3 prints at 1:25 000 (5 MB of tiles each, measured
 *  on a dev copy of the archives), well under the origin quota a phone
 *  gives a site (hundreds of MB), and small enough to be a cache not a store. */
export const CACHE_BUDGET_BYTES = 200 * 1024 * 1024;
/** Evicting stops at this share of the budget, so the next put is not another eviction. */
const EVICT_TO = 0.9;
const CACHE_NAME = "logjam-geopdf-tiles-v1";
const ORIGIN = "https://geopdf-tiles.invalid";
const INDEX_URL = `${ORIGIN}/index`;
/** The index is written this long after the last change. */
const FLUSH_AFTER_MS = 2000;

/** The slice of `CacheStorage` this uses, so a test can stand one in. */
export type CacheStorageLike = {
  open(name: string): Promise<{
    match(url: string): Promise<Response | undefined>;
    put(url: string, response: Response): Promise<void>;
    delete(url: string): Promise<boolean>;
    keys(): Promise<readonly { url: string }[]>;
  }>;
  delete(name: string): Promise<boolean>;
};

type Entry = { size: number; used: number };
type StoredIndex = {
  v: 1;
  /** Archive path → the version (etag) its entries were read at. */
  archives: Record<string, string>;
  /** Entry URL → [size, last use]. */
  entries: Record<string, [number, number]>;
};

const entryUrl = (archive: string, version: string, o: number, l: number) =>
  `${ORIGIN}/${encodeURIComponent(archive)}/${encodeURIComponent(version)}/${o}-${l}`;

export class TileCache {
  private storage: CacheStorageLike;
  private budget: number;
  private now: () => number;
  private loaded: Promise<void> | null = null;
  private entries = new Map<string, Entry>();
  private archives = new Map<string, string>();
  private total = 0;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cleared = false;
  /** Writes under way: `flush` waits for them. */
  private pending = new Set<Promise<void>>();

  constructor(
    storage: CacheStorageLike,
    budget = CACHE_BUDGET_BYTES,
    now: () => number = Date.now,
  ) {
    this.storage = storage;
    this.budget = budget;
    this.now = now;
  }

  private opened: ReturnType<CacheStorageLike["open"]> | null = null;
  /** The cache, opened once: opening it again for every read is a round trip each. */
  private cache() {
    this.opened ??= this.storage.open(CACHE_NAME);
    return this.opened;
  }

  /** The stored index, or one rebuilt from the entries' headers. */
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const cache = await this.cache();
        const stored = await cache.match(INDEX_URL);
        const index = stored ? ((await stored.json()) as StoredIndex) : null;
        if (index?.v === 1) {
          for (const [k, v] of Object.entries(index.archives))
            this.archives.set(k, v);
          for (const [url, [size, used]] of Object.entries(index.entries))
            this.entries.set(url, { size, used });
        }
        // Entries a terminated worker wrote and never indexed: take their
        // own headers' word for size and use.
        const known = new Set(this.entries.keys());
        for (const req of await cache.keys()) {
          if (req.url === INDEX_URL || known.has(req.url)) continue;
          const res = await cache.match(req.url);
          const size = Number(res?.headers.get("x-size"));
          const used = Number(res?.headers.get("x-used"));
          if (res && size > 0) this.entries.set(req.url, { size, used });
          else await cache.delete(req.url);
          this.dirty = true;
        }
        // And index entries whose bytes are gone.
        const present = new Set((await cache.keys()).map((r) => r.url));
        for (const url of [...this.entries.keys()])
          if (!present.has(url)) {
            this.entries.delete(url);
            this.dirty = true;
          }
        this.total = 0;
        for (const e of this.entries.values()) this.total += e.size;
      } catch {
        // No storage: an empty cache that keeps nothing.
      }
    })();
    return this.loaded;
  }

  /**
   * Start reading `archive` at `version`. Whatever else is cached for the
   * archive was read at another version, so it is dropped: the archive
   * changed, and its byte offsets mean something else now.
   */
  async open(archive: string, version: string): Promise<void> {
    await this.load();
    if (this.cleared) return;
    try {
      const was = this.archives.get(archive);
      if (was === version) return;
      this.archives.set(archive, version);
      this.dirty = true;
      if (was !== undefined) {
        const cache = await this.cache();
        const prefix = `${ORIGIN}/${encodeURIComponent(archive)}/`;
        for (const [url, e] of [...this.entries]) {
          if (!url.startsWith(prefix)) continue;
          this.entries.delete(url);
          this.total -= e.size;
          await cache.delete(url);
        }
      }
      this.schedule();
    } catch {
      // as above
    }
  }

  /** The bytes of a range read at `version`, or null. */
  async get(
    archive: string,
    version: string,
    offset: number,
    length: number,
  ): Promise<ArrayBuffer | null> {
    await this.load();
    const url = entryUrl(archive, version, offset, length);
    const entry = this.entries.get(url);
    if (!entry || this.cleared) return null;
    try {
      const res = await (await this.cache()).match(url);
      if (!res) {
        this.entries.delete(url);
        this.total -= entry.size;
        return null;
      }
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength !== length) return null;
      entry.used = this.now();
      this.dirty = true;
      this.schedule();
      return bytes;
    } catch {
      return null;
    }
  }

  /** Keep the bytes of a range read at `version`. */
  put(
    archive: string,
    version: string,
    offset: number,
    length: number,
    bytes: ArrayBuffer,
  ): Promise<void> {
    const write = this.write(archive, version, offset, length, bytes);
    this.pending.add(write);
    void write.finally(() => this.pending.delete(write));
    return write;
  }

  private async write(
    archive: string,
    version: string,
    offset: number,
    length: number,
    bytes: ArrayBuffer,
  ): Promise<void> {
    await this.load();
    if (this.cleared || length > this.budget) return;
    const url = entryUrl(archive, version, offset, length);
    try {
      const used = this.now();
      await (await this.cache()).put(
        url,
        new Response(bytes, {
          headers: { "x-size": String(length), "x-used": String(used) },
        }),
      );
      if (this.cleared) {
        // A sign-out came while the write was in flight.
        await (await this.cache()).delete(url);
        return;
      }
      const old = this.entries.get(url);
      this.total += length - (old?.size ?? 0);
      this.entries.set(url, { size: length, used });
      this.dirty = true;
      this.schedule();
    } catch {
      // A full quota, or no storage: the render has its bytes already.
    }
  }

  private schedule() {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_AFTER_MS);
  }

  /** Evict past the budget, then write the index. Safe to call any time. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.load();
    await Promise.allSettled([...this.pending]);
    if (this.cleared || !this.dirty) return;
    try {
      const cache = await this.cache();
      if (this.total > this.budget) {
        const oldestFirst = [...this.entries].sort(
          (a, b) => a[1].used - b[1].used,
        );
        for (const [url, e] of oldestFirst) {
          if (this.total <= this.budget * EVICT_TO) break;
          this.entries.delete(url);
          this.total -= e.size;
          await cache.delete(url);
        }
      }
      // Another context (a prefetch beside a render) may have written since
      // this one loaded: keep its entries, and the later use of any entry.
      const theirs = await cache.match(INDEX_URL);
      if (theirs) {
        const other = (await theirs.json()) as StoredIndex;
        if (other?.v === 1) {
          const present = new Set((await cache.keys()).map((r) => r.url));
          for (const [url, [size, used]] of Object.entries(other.entries)) {
            const mine = this.entries.get(url);
            if (mine) mine.used = Math.max(mine.used, used);
            else if (present.has(url)) {
              this.entries.set(url, { size, used });
              this.total += size;
            }
          }
        }
      }
      const index: StoredIndex = {
        v: 1,
        archives: Object.fromEntries(this.archives),
        entries: Object.fromEntries(
          [...this.entries].map(([url, e]) => [url, [e.size, e.used]]),
        ),
      };
      if (this.cleared) return;
      await cache.put(INDEX_URL, new Response(JSON.stringify(index)));
      this.dirty = false;
    } catch {
      // Not written; the next change tries again.
    }
  }

  /** Forget everything, here and in storage. */
  async clear(): Promise<void> {
    this.cleared = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.entries.clear();
    this.archives.clear();
    this.total = 0;
    this.opened = null;
    try {
      await this.storage.delete(CACHE_NAME);
    } catch {
      // nothing to clear
    }
  }
}

const browserStorage = (): CacheStorageLike | null => {
  try {
    return typeof caches === "undefined"
      ? null
      : (caches as unknown as CacheStorageLike);
  } catch {
    return null;
  }
};

/** This context's cache, or null where the browser has none. */
export function tileCache(): TileCache | null {
  const storage = browserStorage();
  return storage ? new TileCache(storage) : null;
}

/**
 * Empty the persistent tile cache. Every sign-out path calls this, and so
 * does the sign-in screen: it never throws and does not wait on storage that
 * is not there.
 */
export async function clearTileCache(): Promise<void> {
  try {
    await browserStorage()?.delete(CACHE_NAME);
  } catch {
    // no cache storage
  }
}
