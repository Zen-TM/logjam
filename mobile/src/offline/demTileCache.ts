// Decoded DEM tiles held in memory, tagged with WHERE THEY CAME FROM.
//
// The origin matters because of "Simulating offline mode". That mode exists so
// the user can find out, at home, what the map will do in the canyon — so a
// tile fetched over the network minutes ago must NOT answer while it is on.
// It is not a privacy leak (no request goes out to read RAM), it is a HONESTY
// one: answering from it fabricates coverage the field trip will not have, and
// a simulation that lies is worse than no simulation.
//
// Its own module, free of expo-sqlite, so the rule has a test.
//
// One tile is 256 KB of float metres, and a profile re-samples the same handful
// on every vertex drag, so this is what keeps dragging a route cheap.
// Insertion-ordered eviction, like the API's cache: the access pattern is a
// burst over neighbouring tiles, where true LRU would barely differ.
export type TileOrigin = "saved" | "network";

const MAX_CACHED_TILES = 8;

type Entry = { tile: Float32Array; origin: TileOrigin };

const entries = new Map<string, Entry>();

export function cacheTile(
  key: string,
  tile: Float32Array,
  origin: TileOrigin,
): void {
  if (entries.size >= MAX_CACHED_TILES) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  entries.set(key, { tile, origin });
}

/**
 * The cached tile, or undefined when nothing usable is held.
 *
 * `allowNetwork: false` hides network-sourced tiles — see the note above.
 */
export function cachedTile(
  key: string,
  { allowNetwork }: { allowNetwork: boolean },
): Float32Array | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (!allowNetwork && entry.origin === "network") return undefined;
  return entry.tile;
}

/** Dropped on wipe/sign-out: the cache holds terrain around the user's area. */
export function clearDemTileCache(): void {
  entries.clear();
}
