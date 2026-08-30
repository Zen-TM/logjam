import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "./awsClients";
import { getEnv } from "../lib/env";
import { logger, safeErrorForLog } from "../lib/logger";
import { AppError } from "../middleware/errorHandler";
import {
  fetchAndParseRopeWiki,
  parseRopeWikiCsv,
  type RopeWikiCanyon,
} from "./ropewiki";

const TTL_MS = 60 * 60 * 1000;

/**
 * RopeWiki went behind a Cloudflare managed challenge (confirmed 2026-08-30:
 * every path, including the homepage, returns 403 with `cf-mitigated:
 * challenge` for any non-browser client — User-Agent makes no difference, and
 * prod logged `RopeWiki returned HTTP 403` on POST /ropewiki/refresh). The
 * live fetch therefore cannot be the default source any more.
 *
 * Instead the corpus is a CSV snapshot exported by hand from a browser and
 * uploaded to S3. NSW canyons change a handful of times a year, so a manual
 * refresh every few months loses nothing:
 *
 *   aws s3 cp ropewiki_nsw.csv \
 *     s3://$S3_BUCKET_MEDIA/reference/ropewiki-nsw.csv \
 *     --profile logjam --region ap-southeast-2
 *
 * Raw CSV, not pre-parsed JSON, so a parser fix ships by redeploy rather than
 * needing a re-download we currently cannot do.
 *
 * It lives in the media bucket rather than getting one of its own: the orphan
 * sweeper is scoped to `Prefix: "media/"` AND a media/<owner>/<id>/<file> key
 * pattern (see lib/mediaOrphanSweeper.ts), so a `reference/` key is out of its
 * reach twice over.
 */
const SNAPSHOT_KEY = "reference/ropewiki-nsw.csv";

export type RopeWikiData = {
  canyons: RopeWikiCanyon[];
  errors: string[];
  /**
   * When the underlying CSV last changed at its source — the S3 object's
   * LastModified for the snapshot, or the fetch time for a live fetch. Surfaced
   * to the client so the UI can say how stale the corpus is; null only if S3
   * omits LastModified.
   */
  sourceUpdatedAt: Date | null;
};

type CacheEntry = RopeWikiData & { loadedAt: number };

let cache: CacheEntry | null = null;

async function loadSnapshotFromS3(): Promise<RopeWikiData> {
  const bucket = getEnv().S3_BUCKET_MEDIA;
  if (!bucket) {
    throw new AppError(503, "RopeWiki snapshot unavailable: no bucket configured");
  }

  let body: string;
  let lastModified: Date | undefined;
  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: SNAPSHOT_KEY }),
    );
    if (!response.Body) {
      throw new Error(`S3 returned no body for ${SNAPSHOT_KEY}`);
    }
    body = await response.Body.transformToString();
    lastModified = response.LastModified;
  } catch (err) {
    // Log the real cause (missing key, denied, bad creds) and hand the client a
    // 503 that names the fix — a bare throw here becomes a generic 500.
    logger.error(
      { err: safeErrorForLog(err), key: SNAPSHOT_KEY },
      "ropewiki_snapshot_load_failed",
    );
    throw new AppError(
      503,
      "RopeWiki snapshot unavailable — upload one to reference/ropewiki-nsw.csv",
    );
  }

  const { canyons, errors } = parseRopeWikiCsv(body);
  return { canyons, errors, sourceUpdatedAt: lastModified ?? null };
}

/**
 * Returns the RopeWiki corpus, memoised for TTL_MS.
 *
 * Default source is the S3 snapshot. `fresh` re-reads the source, and attempts
 * the live RopeWiki fetch — kept wired up so that if RopeWiki ever allowlists
 * us the live path is one default away, rather than needing to be rebuilt.
 */
export async function getRopeWikiCanyons(
  fresh = false,
): Promise<RopeWikiData> {
  if (!fresh && cache && Date.now() - cache.loadedAt < TTL_MS) {
    const { loadedAt: _loadedAt, ...data } = cache;
    return data;
  }

  const data: RopeWikiData = fresh
    ? { ...(await fetchAndParseRopeWiki()), sourceUpdatedAt: new Date() }
    : await loadSnapshotFromS3();

  cache = { ...data, loadedAt: Date.now() };
  return data;
}

export function clearRopeWikiCache(): void {
  cache = null;
}
