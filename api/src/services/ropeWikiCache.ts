import {
  fetchAndParseRopeWiki,
  type RopeWikiCanyon,
} from "./ropewiki";

const TTL_MS = 60 * 60 * 1000;

type CacheEntry = {
  fetchedAt: number;
  canyons: RopeWikiCanyon[];
  errors: string[];
};

let cache: CacheEntry | null = null;

export async function getRopeWikiCanyons(
  fresh = false,
): Promise<{ canyons: RopeWikiCanyon[]; errors: string[] }> {
  if (!fresh && cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return { canyons: cache.canyons, errors: cache.errors };
  }
  const { canyons, errors } = await fetchAndParseRopeWiki();
  cache = { fetchedAt: Date.now(), canyons, errors };
  return { canyons, errors };
}

export function clearRopeWikiCache(): void {
  cache = null;
}
