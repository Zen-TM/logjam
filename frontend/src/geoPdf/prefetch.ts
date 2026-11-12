// Warms the persistent tile cache (cache.ts) with the statewide tiles a
// GeoPDF will read, in the background while its dialog is open, so Make it
// often starts warm. Runs in its own worker, at low concurrency, and ends the
// moment it is told to: it must never slow the render it is meant to help.
//
// PRIVACY: statewide archives on our own origin only (`openArchive` keeps no
// other kind, and `statewideReads` plans no other). A third-party base tile is
// never fetched here: a provider's terms are the limit, and a prefetch is
// bulk. Nothing here logs; a tile index is a coarse location.
import { tileCache } from "./cache";
import { statewideReads } from "./plan";
import { openArchive, TileFetcher } from "./tiles";
import type { GeoPdfRenderInput } from "./types";

/** Reads in flight at once: a prefetch yields the link to anything else. */
export const PREFETCH_CONCURRENCY = 4;
/** A print asking for more than this is not warmed (about 50 MB of tiles). */
export const MAX_PREFETCH_READS = 1500;

/** Fetch what `input` will read into the cache; resolves when done or aborted. */
export async function prefetchTiles(
  input: GeoPdfRenderInput,
  signal: AbortSignal,
): Promise<void> {
  const store = tileCache();
  if (!store) return;
  const reads = statewideReads(input);
  if (reads.length === 0 || reads.length > MAX_PREFETCH_READS) return;
  const fetcher = new TileFetcher(
    signal,
    input.origin,
    () => PREFETCH_CONCURRENCY,
  );
  const archives = new Map<string, ReturnType<typeof openArchive>>();
  const opened = new Map<string, Promise<boolean>>();
  const archiveAt = (path: string) => {
    const url = `${input.origin}/${path}`;
    let a = archives.get(path);
    if (!a) {
      a = openArchive(url, signal, { store, origin: input.origin });
      archives.set(path, a);
      opened.set(path, fetcher.open(a, url));
    }
    return { url, archive: a, ok: opened.get(path)! };
  };
  try {
    await Promise.all(
      reads.map(async (r, i) => {
        const { url, archive, ok } = archiveAt(r.path);
        if (!(await ok)) return;
        await fetcher.archive(archive, url, r.z, r.x, r.y, i);
      }),
    );
    await store.flush();
  } catch {
    // Aborted, or a tile that would not come: the render asks for it again.
  }
}
