// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { TileCache, type CacheStorageLike } from "./cache";

/** A CacheStorage in memory: names → url → body and headers. */
function fakeStorage() {
  const caches = new Map<
    string,
    Map<string, { body: ArrayBuffer; headers: [string, string][] }>
  >();
  const storage: CacheStorageLike = {
    async open(name) {
      let entries = caches.get(name);
      if (!entries) {
        entries = new Map();
        caches.set(name, entries);
      }
      const mine = entries;
      return {
        async match(url) {
          const e = mine.get(url);
          return e
            ? new Response(e.body.slice(0), { headers: e.headers })
            : undefined;
        },
        async put(url, res) {
          mine.set(url, {
            body: await res.arrayBuffer(),
            headers: [...res.headers],
          });
        },
        async delete(url) {
          return mine.delete(url);
        },
        async keys() {
          return [...mine.keys()].map((url) => ({ url }));
        },
      };
    },
    async delete(name) {
      return caches.delete(name);
    },
  };
  return { storage, caches };
}

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill).buffer;
const A = "master/dem/a.pmtiles";

describe("TileCache", () => {
  it("returns what was kept, under the version it was read at only", async () => {
    const { storage } = fakeStorage();
    const cache = new TileCache(storage);
    await cache.open(A, "v1");
    await cache.put(A, "v1", 100, 4, bytes(4, 7));
    expect(new Uint8Array((await cache.get(A, "v1", 100, 4))!)).toEqual(
      new Uint8Array([7, 7, 7, 7]),
    );
    expect(await cache.get(A, "v1", 100, 5)).toBeNull();
    expect(await cache.get(A, "v2", 100, 4)).toBeNull();
    expect(await cache.get("master/dem/b.pmtiles", "v1", 100, 4)).toBeNull();
  });

  it("remembers across a reload: a new cache over the same storage reads the entries", async () => {
    const { storage } = fakeStorage();
    const first = new TileCache(storage);
    await first.open(A, "v1");
    await first.put(A, "v1", 0 + 10, 3, bytes(3, 9));
    await first.flush();
    const second = new TileCache(storage);
    expect(new Uint8Array((await second.get(A, "v1", 10, 3))!)).toEqual(
      new Uint8Array([9, 9, 9]),
    );
  });

  // Mutation: let `open` keep the entries of the old version, and the old
  // archive's offsets are served for the new one.
  it("drops an archive's entries when its version changes", async () => {
    const { storage, caches } = fakeStorage();
    const cache = new TileCache(storage);
    await cache.open(A, "v1");
    await cache.put(A, "v1", 10, 3, bytes(3));
    await cache.flush();
    await cache.open(A, "v2");
    await cache.flush();
    expect(await cache.get(A, "v1", 10, 3)).toBeNull();
    // Gone from storage too, not only forgotten: just the index remains.
    expect([...caches.values()][0]!.size).toBe(1);
  });

  // Mutation: compare against the budget only after the write, or evict the
  // newest first: the first entry is not the one that goes.
  it("evicts the least recently used past the budget", async () => {
    let clock = 1000;
    const { storage } = fakeStorage();
    const cache = new TileCache(storage, 100, () => clock++);
    await cache.open(A, "v1");
    for (const offset of [10, 20, 30])
      await cache.put(A, "v1", offset, 40, bytes(40));
    // Touch the oldest, so the middle one is now the least recently used.
    await cache.get(A, "v1", 10, 40);
    await cache.flush();
    expect(await cache.get(A, "v1", 20, 40)).toBeNull();
    expect(await cache.get(A, "v1", 10, 40)).not.toBeNull();
    expect(await cache.get(A, "v1", 30, 40)).not.toBeNull();
  });

  it("stays under its budget however much is put", async () => {
    const { storage, caches } = fakeStorage();
    const cache = new TileCache(storage, 1000);
    await cache.open(A, "v1");
    for (let i = 0; i < 50; i++) {
      await cache.put(A, "v1", 100 + i * 100, 90, bytes(90));
      await cache.flush();
    }
    const stored = [...caches.values()][0]!;
    let size = 0;
    for (const [url, e] of stored)
      if (!url.endsWith("/index")) size += e.body.byteLength;
    expect(size).toBeLessThanOrEqual(1000);
  });

  it("rebuilds the index from the entries when it was never written", async () => {
    const { storage } = fakeStorage();
    const first = new TileCache(storage);
    await first.open(A, "v1");
    await first.put(A, "v1", 10, 3, bytes(3, 5));
    // A worker ended before its flush: no index in storage.
    const second = new TileCache(storage, 5);
    await second.open(A, "v1");
    expect(await second.get(A, "v1", 10, 3)).not.toBeNull();
    // And its size counts toward the budget it was rebuilt under.
    await second.put(A, "v1", 20, 3, bytes(3, 6));
    await second.flush();
    expect(await second.get(A, "v1", 10, 3)).toBeNull();
  });

  // Mutation: make `clear` a no-op, or let put write after it.
  it("is empty after clear, and a write in flight at the time is not kept", async () => {
    const { storage, caches } = fakeStorage();
    const cache = new TileCache(storage);
    await cache.open(A, "v1");
    await cache.put(A, "v1", 10, 3, bytes(3));
    await cache.flush();
    const late = cache.put(A, "v1", 20, 3, bytes(3));
    await cache.clear();
    await late;
    expect(caches.size).toBe(0);
    expect(await cache.get(A, "v1", 10, 3)).toBeNull();
  });

  it("works with no storage at all", async () => {
    const broken: CacheStorageLike = {
      open: () => Promise.reject(new Error("denied")),
      delete: () => Promise.reject(new Error("denied")),
    };
    const cache = new TileCache(broken);
    await cache.open(A, "v1");
    await cache.put(A, "v1", 10, 3, bytes(3));
    expect(await cache.get(A, "v1", 10, 3)).toBeNull();
    await cache.flush();
    await cache.clear();
  });

  // Mutation: set `dirty = false` after the index write instead of before: a
  // put during the write is then marked clean and never indexed.
  it("keeps a change made during an index write dirty", async () => {
    const { storage } = fakeStorage();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let writing: (() => void) | null = null;
    const started = new Promise<void>((r) => (writing = r));
    const real = storage.open.bind(storage);
    const slow: CacheStorageLike = {
      ...storage,
      open: async (name) => {
        const c = await real(name);
        return {
          ...c,
          put: async (url, res) => {
            if (url.endsWith("/index") && writing) {
              writing();
              writing = null;
              await gate;
            }
            return c.put(url, res);
          },
        };
      },
    };
    const cache = new TileCache(slow);
    await cache.open(A, "v1");
    await cache.put(A, "v1", 10, 3, bytes(3));
    const flushing = cache.flush();
    await started;
    await cache.put(A, "v1", 20, 3, bytes(3));
    release();
    await flushing;
    await cache.flush();
    const reloaded = new TileCache(storage, 5);
    await reloaded.open(A, "v1");
    // Both entries are in the index (a rebuilt one would also hold both, so
    // read it as stored: the second put must have been written by the second flush).
    const stored = await (await storage.open("logjam-geopdf-tiles-v1")).match(
      "https://geopdf-tiles.invalid/index",
    );
    const index = (await stored!.json()) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(index.entries)).toHaveLength(2);
  });

  it("flushes on a timer after a change", async () => {
    vi.useFakeTimers();
    try {
      const { storage, caches } = fakeStorage();
      const cache = new TileCache(storage);
      await cache.open(A, "v1");
      await cache.put(A, "v1", 10, 3, bytes(3));
      await vi.advanceTimersByTimeAsync(2500);
      const stored = [...caches.values()][0]!;
      expect([...stored.keys()].some((u) => u.endsWith("/index"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
