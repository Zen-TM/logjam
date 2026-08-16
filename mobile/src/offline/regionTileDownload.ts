// Tile-pyramid region downloader (stage4a-basemaps.md §5) — the engine behind
// "save these maps for offline use".
//
// Client-direct: tiles come straight from the provider to the phone, and NO
// part of this path talks to the Logjam API. That is a privacy property, not an
// accident — the area a user is about to walk into never reaches our server
// (mobile/CLAUDE.md: region-of-interest bboxes stay off the server).
//
// POLITENESS ENVELOPE (§5.4) — the contract that makes bulk-ish fetching
// acceptable. Load shape, not disguise:
//   - concurrency 2 (a panning browser opens ~6 connections; we stay under it)
//   - token bucket, capacity 6 refilling 3/s with ±20 % jitter, so a burst looks
//     like a pan and the sustained rate is ~3 tiles/s
//   - default platform User-Agent, no referer spoofing, no browser impersonation
//   - NO app-identifying headers: never `x-logjam-client`, never an auth token.
//     A provider request must be a plain HTTP client, in both senses.
//   - a 403 or 429 stops the whole job immediately rather than retrying into it
//
// The ToS gate (§2) was cleared by the operator for the three NSW SIX rasters,
// whose CC licence permits redistribution; `offlineCapable` in the shared basemap
// catalog stays the single source of which sources may be downloaded at all.
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import * as FileSystem from "expo-file-system/legacy";
import { fetch as expoFetch } from "expo/fetch";
import {
  BASEMAP_CATALOG,
  DEM_ATTRIBUTION,
  DEM_SOURCE_ID,
  DEM_TILE_URL_TEMPLATE,
  REGION_MIN_ZOOM,
  planRegionTiles,
  type DownloadableTileSourceId,
  type RegionBbox,
} from "@logjam/shared";

import type { MapArtifact } from "../map/sourceResolver";
import { failureDetail } from "./failureDetail";
import { connectionAllowsMetered } from "./networkPolicy";
import { insertArtifact } from "./registryDb";
import {
  classifyTileResponse,
  deadTileBudget,
  regionPlanHash,
  regionTileSequence,
  tileUrlFrom,
  type TileVerdict,
} from "./regionTilePlanning";
import {
  closeRegionMbtiles,
  countRegionTiles,
  deleteRegionFile,
  finalizeRegionMbtiles,
  initRegionMbtiles,
  listRegionTileKeys,
  openRegionMbtiles,
  readRegionBuildState,
  sampleRegionTilesLookLikeImages,
  writeRegionBatch,
  type RegionBuildState,
  type RegionTile,
} from "./regionMbtiles";

/**
 * Why a job stopped without failing. `user` and `provider-backoff` are the two
 * nobody else may overturn — see `resumeJobsPausedBy` in the queue.
 *
 * (It used to live in `downloadMachine.ts`, a state machine from the original
 * plan that nothing ever installed: the queue shipped with its own state union
 * and the SIXMaps engine landed with a third. The machine and its 97-line test
 * suite are deleted; this type was the only part of the file with a consumer.)
 */
export type PausedReason =
  | "user"
  | "connectivity"
  | "background"
  | "provider-backoff";

export type RegionJobSpec = {
  /** uuid — also the MBTiles filename, and the artifact id on success. */
  id: string;
  /** A basemap, or the DEM that rides along with every region. */
  basemapId: DownloadableTileSourceId;
  /** User-facing name; goes in the MBTiles `name` row and the Saved list. */
  label: string;
  /** The download run this job belongs to — see MapArtifact.groupId. */
  groupId: string;
  /** The name the user gave that run's area, live-editable while it downloads. */
  groupLabel: string;
  bbox: RegionBbox;
  /**
   * Shallowest level to fetch. Defaults to `REGION_MIN_ZOOM` — a basemap needs
   * the zoomed-out context levels or the offline map is blank when you pinch
   * out. The DEM sets it equal to `zMax`: it is read at exactly one zoom, so
   * every other level would be tiles nothing ever opens.
   */
  zMin?: number;
  zMax: number;
  /** Per-job opt-in; Wi-Fi-only otherwise (§5.6). */
  allowCellular: boolean;
};

export type RegionJobProgress = {
  tilesDone: number;
  tilesTotal: number;
  /** 404 at source — uncached area. Not a failure. */
  tilesGap: number;
  /** Retries exhausted. A handful is tolerable; a lot fails the job. */
  tilesFailed: number;
  bytesDone: number;
  /** Known only for the single-file (clip) task kind; 0 means "counting tiles". */
  bytesTotal: number;
};

export type RegionRunOutcome =
  | { status: "ready"; artifact: MapArtifact; gaps: number; failed: number }
  | { status: "paused"; reason: PausedReason }
  | { status: "cancelled" }
  | { status: "failed"; code: RegionFailureCode; detail?: string };

export type RegionFailureCode =
  | "provider-errors"
  | "verify-failed"
  /**
   * The SERVER can't cut this map right now — the vector clip's 5xx, as
   * against anything the phone did. Separate from `unknown` because the two
   * deserve opposite advice: "try again" is right for a dropped connection and
   * wrong for an endpoint that will keep refusing until an operator fixes it.
   */
  | "source-unavailable"
  /**
   * The SERVER refused this area for the vector clip — outside the NSW archive
   * extract, or larger than the clip cap. A 4xx, so retrying it unchanged can
   * only fail again; the user has to reframe.
   */
  | "region-rejected"
  | "unknown";

/**
 * How a caller stops a running job. The two are NOT the same outcome: a pause
 * keeps the partial MBTiles (it is a lossless resume point), a cancel deletes
 * it. One boolean for both is how a paused download loses its tiles.
 */
export type RegionCancelToken = { stop: null | "pause" | "cancel" };

// ── Politeness ───────────────────────────────────────────────────────────────

const BUCKET_CAPACITY = 6;
const BUCKET_REFILL_PER_SECOND = 3;
const CONCURRENCY = 2;
const TILE_TIMEOUT_MS = 15_000;
const MAX_TILE_ATTEMPTS = 5;
const BATCH_TILES = 16;
const BATCH_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ±20 % so the request trace isn't metronomic. */
function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4);
}

class TokenBucket {
  private tokens = BUCKET_CAPACITY;
  private lastRefill = Date.now();

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(
        BUCKET_CAPACITY,
        this.tokens + ((now - this.lastRefill) / 1000) * BUCKET_REFILL_PER_SECOND,
      );
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(jitter((1000 * (1 - this.tokens)) / BUCKET_REFILL_PER_SECOND));
    }
  }
}

/**
 * Region downloads answer to the same metered rule as every other job
 * (`networkPolicy.ts`), not to `type === "wifi"`: a tethered hotspot is Wi-Fi by
 * type and mobile data by cost, and this is the largest data cost in the app.
 * The per-job opt-in (§5.6) takes the place of the stored preference.
 */
export async function connectionAllows(allowCellular: boolean): Promise<boolean> {
  const state = await NetInfo.fetch();
  if (state.isConnected !== true) return false;
  return connectionAllowsMetered(state, allowCellular);
}

/**
 * Where a downloadable source's tiles come from, what to credit, and what the
 * finished file IS.
 *
 * The DEM is not in `BASEMAP_CATALOG` and must not be: the catalog is the list
 * of maps the layer picker offers, and nothing draws terrarium tiles. It is
 * still fetched by this same engine under the same politeness envelope, so the
 * only thing that differs is these three fields.
 */
function tileSourceFor(sourceId: DownloadableTileSourceId): {
  urlTemplate: string;
  attribution: string;
  kind: MapArtifact["kind"];
} {
  if (sourceId === DEM_SOURCE_ID) {
    return {
      urlTemplate: DEM_TILE_URL_TEMPLATE,
      attribution: DEM_ATTRIBUTION,
      kind: "dem-region",
    };
  }
  const entry = BASEMAP_CATALOG.find((candidate) => candidate.id === sourceId);
  if (!entry) throw new Error(`Unknown basemap id: ${sourceId}`);
  if (!entry.offlineCapable) {
    // A programming error: the picker must never offer a source the catalog
    // marks online-only.
    throw new Error(`Basemap ${sourceId} is not offline-capable`);
  }
  return {
    urlTemplate: entry.urlTemplate,
    attribution: entry.attribution,
    kind: "basemap-region",
  };
}

// ── The engine ───────────────────────────────────────────────────────────────

/**
 * Download (or resume) one region. Returns rather than throws for every outcome
 * the user can act on; only a programming error propagates.
 *
 * On `ready` the region is registered in the artifact registry, at which point
 * the map resolver picks it up with no further wiring — the map renders it
 * offline from that moment.
 */
export async function runRegionDownload(
  spec: RegionJobSpec,
  onProgress: (progress: RegionJobProgress) => void,
  token: RegionCancelToken,
): Promise<RegionRunOutcome> {
  const source = tileSourceFor(spec.basemapId);
  const zMin = spec.zMin ?? REGION_MIN_ZOOM;
  const plan = planRegionTiles(spec.bbox, zMin, spec.zMax);
  const planHash = regionPlanHash({ ...spec, zMin });
  const target = await openRegionMbtiles(spec.id);

  try {
    await initRegionMbtiles(target, {
      label: spec.label,
      groupId: spec.groupId,
      groupLabel: spec.groupLabel,
      basemapId: spec.basemapId,
      kind: source.kind,
      bbox: spec.bbox,
      zMin,
      zMax: spec.zMax,
      attribution: source.attribution,
      planHash,
    });

    const checkpoint = await readRegionBuildState(target.db);
    const gaps = new Set(
      (checkpoint?.planHash === planHash ? checkpoint.gaps : []).map(
        ([z, x, y]) => `${z}/${x}/${y}`,
      ),
    );
    const done = await listRegionTileKeys(target.db);

    const queue = regionTileSequence(plan).filter(([z, x, y]) => {
      const key = `${z}/${x}/${y}`;
      return !done.has(key) && !gaps.has(key);
    });

    const bucket = new TokenBucket();
    let cursor = 0;
    let tilesDone = done.size;
    let bytesDone = 0;
    let dead = 0;
    let pending: RegionTile[] = [];
    let lastFlush = Date.now();
    // Set by any worker; every worker checks it and stops. Held in an object
    // rather than a bare `let` because it is only ever assigned inside the
    // worker closure, and TS's control-flow analysis would narrow a plain local
    // to `never` at the checks below.
    const halt: {
      stop:
        | { kind: "paused"; reason: PausedReason }
        | { kind: "cancelled" }
        | { kind: "failed"; code: RegionFailureCode }
        | null;
    } = { stop: null };

    const buildState = (): RegionBuildState => ({
      v: 1,
      planHash,
      gaps: [...gaps].map((key) => {
        const [z, x, y] = key.split("/").map(Number);
        return [z, x, y] as [number, number, number];
      }),
    });

    const report = () =>
      onProgress({
        tilesDone,
        tilesTotal: plan.totalTiles,
        tilesGap: gaps.size,
        tilesFailed: dead,
        bytesDone,
        bytesTotal: 0,
      });

    // Gaps are part of the checkpoint, not a side effect of writing tiles.
    // Flushing only when a TILE was fetched meant a run of 404s persisted
    // nothing and reported nothing: SIX imagery LOD coverage is blocky, so a
    // wilderness region's deepest zoom can be hundreds of consecutive 404s.
    // Killing the app in there lost the whole gap list, and the resume then
    // re-poked the provider for every one of them at 3/s — precisely what
    // regionMbtiles.ts says must not happen — while the user watched a frozen
    // counter for two minutes and reasonably concluded it had hung.
    let gapsAtLastFlush = 0;
    const flush = async (force: boolean) => {
      const newGaps = gaps.size !== gapsAtLastFlush;
      if (pending.length === 0 && !newGaps) return;
      if (
        !force &&
        pending.length < BATCH_TILES &&
        Date.now() - lastFlush < BATCH_MS
      ) {
        return;
      }
      const batch = pending;
      pending = [];
      lastFlush = Date.now();
      gapsAtLastFlush = gaps.size;
      await writeRegionBatch(target, batch, buildState());
      report();
    };

    const fetchTile = async (
      z: number,
      x: number,
      y: number,
    ): Promise<{ verdict: TileVerdict; bytes?: Uint8Array }> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TILE_TIMEOUT_MS);
      try {
        // No headers at all: the platform default User-Agent and nothing else.
        const response = await expoFetch(
          tileUrlFrom(source.urlTemplate, z, x, y),
          { signal: controller.signal },
        );
        if (response.status !== 200) {
          return {
            verdict: classifyTileResponse(response.status, null, 0),
          };
        }
        const bytes = await response.bytes();
        const verdict = classifyTileResponse(
          response.status,
          response.headers.get("content-type"),
          bytes.byteLength,
        );
        return verdict === "ok" ? { verdict, bytes } : { verdict };
      } catch {
        // Timeout, DNS, TLS, socket — all retryable, and none of them get their
        // message anywhere near a log line (it can carry the URL).
        return { verdict: "retry" };
      } finally {
        clearTimeout(timer);
      }
    };

    const worker = async () => {
      while (halt.stop === null) {
        if (token.stop === "cancel") {
          halt.stop = { kind: "cancelled" };
          return;
        }
        if (token.stop === "pause") {
          halt.stop = { kind: "paused", reason: "user" };
          return;
        }
        const index = cursor++;
        if (index >= queue.length) return;
        const [z, x, y] = queue[index];

        // Connectivity is re-checked every batch's worth of tiles rather than
        // per tile: NetInfo.fetch() is a native round-trip, and the fetch
        // itself fails fast when the connection has actually gone.
        if (index % BATCH_TILES === 0 && !(await connectionAllows(spec.allowCellular))) {
          halt.stop = { kind: "paused", reason: "connectivity" };
          return;
        }
        if (AppState.currentState !== "active") {
          // Foreground-only in v1 (§5.6): OS background budgets make a tile loop
          // flaky, and the file is a lossless checkpoint, so parking is cheap.
          halt.stop = { kind: "paused", reason: "background" };
          return;
        }

        let attempt = 0;
        for (;;) {
          await bucket.take();
          const result = await fetchTile(z, x, y);
          if (result.verdict === "ok" && result.bytes) {
            pending.push({ z, x, y, bytes: result.bytes });
            tilesDone += 1;
            bytesDone += result.bytes.byteLength;
            await flush(false);
            break;
          }
          if (result.verdict === "gap") {
            gaps.add(`${z}/${x}/${y}`);
            await flush(false);
            break;
          }
          if (result.verdict === "backoff") {
            // The provider pushed back. Stop the whole job now — grinding
            // through retries is exactly what the envelope exists to prevent.
            halt.stop = { kind: "paused", reason: "provider-backoff" };
            return;
          }
          attempt += 1;
          if (attempt >= MAX_TILE_ATTEMPTS) {
            dead += 1;
            if (dead > deadTileBudget(plan.totalTiles)) {
              halt.stop = { kind: "failed", code: "provider-errors" };
              return;
            }
            break;
          }
          await sleep(jitter(1000 * 2 ** (attempt - 1)));
        }
      }
    };

    report();
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    await flush(true);

    if (halt.stop?.kind === "cancelled") {
      await closeRegionMbtiles(target);
      await deleteRegionFile(spec.id);
      return { status: "cancelled" };
    }
    if (halt.stop?.kind === "failed") {
      await closeRegionMbtiles(target);
      return { status: "failed", code: halt.stop.code };
    }
    if (halt.stop?.kind === "paused") {
      await closeRegionMbtiles(target);
      return { status: "paused", reason: halt.stop.reason };
    }

    // Verify before declaring it usable: every planned tile is accounted for as
    // stored, gapped or dead, and a sample of the stored blobs really is imagery.
    const stored = await countRegionTiles(target.db);
    const accounted = stored + gaps.size + dead;
    if (accounted < plan.totalTiles || !(await sampleRegionTilesLookLikeImages(target.db))) {
      await closeRegionMbtiles(target);
      return { status: "failed", code: "verify-failed" };
    }

    // The real cost on disk, not this session's byte counter — a resumed job
    // only counted the tiles IT fetched, and Saved reports storage from this
    // number (DESIGN.md §8: report the true cost of a thing).
    const info = await FileSystem.getInfoAsync(target.uri);
    const artifact: MapArtifact = {
      id: spec.id,
      kind: source.kind,
      logicalKey: spec.basemapId,
      format: "mbtiles",
      sourceType: "raster",
      path: target.path,
      bbox: [spec.bbox.west, spec.bbox.south, spec.bbox.east, spec.bbox.north],
      minzoom: zMin,
      maxzoom: spec.zMax,
      sizeBytes: info.exists ? (info.size ?? bytesDone) : bytesDone,
      downloadedAt: new Date().toISOString(),
      label: spec.label,
      groupId: spec.groupId,
      groupLabel: spec.groupLabel,
    };
    // Registry row FIRST, then drop the build-state marker. Finalizing first
    // opened a window in which the file had neither: listUnfinishedRegions
    // skips it (no build state), listArtifacts doesn't know it, and the Saved
    // storage total is computed from registry rows — so a process kill in
    // there turned a finished 17 MB region into invisible, unusable,
    // undeletable disk. This order can only ever leave the region listed
    // twice, which is visible and recoverable.
    await insertArtifact(artifact);
    await finalizeRegionMbtiles(target, gaps.size);
    await closeRegionMbtiles(target);
    return { status: "ready", artifact, gaps: gaps.size, failed: dead };
  } catch (err) {
    await closeRegionMbtiles(target);
    // The file stays: it is a valid resume point, and a failed job is offered
    // as resumable rather than silently discarded.
    //
    // The message travels WITH the failure. `unknown` is the catch-all, and it
    // used to be the whole story the user and the developer got: the row said
    // "That didn't finish. Try again." and the cause went to `console.error`,
    // which in a release build is a logcat line nobody is attached to. The
    // first real one to show up this way was SQLITE_BUSY on a region file
    // ("database is locked"), and it cost a device repro to name.
    console.error(err);
    return { status: "failed", code: "unknown", detail: failureDetail(err) };
  }
}
