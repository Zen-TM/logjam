// The flow network lookup: how much land drains through a point, read from
// the flow network layer (topo/build_flow_network.py), a GeoPackage of creek
// segments that each carry their catchment area at both ends.
//
// WHY A WHOLE FILE ON LOCAL DISK. A GeoPackage is SQLite, and SQLite reads
// pages wherever its indexes send it: one lookup is a few R-tree pages, an
// upstream walk thousands of scattered rows. Over S3 byte ranges each of those
// is a round trip, so the file is fetched once and opened read-only from the
// temp directory.
//
// PRIVACY: a click is a precise wilderness position. Nothing here logs one, or
// a segment, or a basin's name: only whether the layer could be read.
import { createWriteStream, existsSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  FLOW_NETWORK_SNAP_M,
  FLOW_NETWORK_UPSTREAM_CAP,
  NSW_5M,
  say,
  type FlowNetworkLookup,
  type FlowNetworkSegmentFeature,
  type FlowNetworkUpstream,
} from "@logjam/shared";
import { s3 } from "./awsClients";
import { getEnv } from "../lib/env";
import { logger, safeErrorForLog } from "../lib/logger";
import { AppError } from "../middleware/errorHandler";
import {
  gpkgLineString,
  gpkgPolygons,
  type Position,
} from "../lib/flowNetwork/gpkgGeometry";
import {
  bboxOf,
  blend,
  boxAround,
  chooseCreek,
  inPolygons,
  lineDownTo,
  nearestOnLine,
  walkWithinCap,
} from "../lib/flowNetwork/snap";
import { FLOW_NETWORK_KEY } from "../lib/flowNetwork/objectKey";

/** How long a layer that would not load is left alone. */
const RETRY_MS = 5 * 60_000;
/** How often the layer in S3 is checked for a rebuild. */
const RECHECK_MS = 5 * 60_000;

export type FlowNetworkLayer = {
  db: DatabaseSync;
  path: string;
  etag: string | undefined;
  checkedAt: number;
  candidates: StatementSync;
  basins: StatementSync;
  upstream: StatementSync;
  segments: StatementSync;
};

let layer: FlowNetworkLayer | null = null;
/** One download at a time, shared by every request that arrives during it. */
let loading: Promise<FlowNetworkLayer> | null = null;
let failedAt: number | null = null;
/**
 * One rebuild check at a time. A download can outlast RECHECK_MS, and a second
 * check that started meanwhile would be handed the same new layer and retire
 * it as stale while the first was swapping it in.
 */
let refreshing: Promise<void> | null = null;

const UNAVAILABLE = say`Catchment sizes aren't available right now. Please try again later.`;

/** A flow network GeoPackage on local disk, opened read-only. */
export function openFlowNetwork(path: string, etag?: string): FlowNetworkLayer {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      db,
      path,
      etag,
      checkedAt: Date.now(),
      // Plain `?`: node:sqlite rejected numbered `?1` parameters.
      candidates: db.prepare(
        `select f.fid, f.geom, f.catchment_start_km2, f.catchment_end_km2, f.stream_order
           from rtree_flow_network_geom r join flow_network f on f.fid = r.id
          where r.minx <= ? and r.maxx >= ? and r.miny <= ? and r.maxy >= ?`,
      ),
      basins: db.prepare(
        `select b.geom from rtree_basins_geom r join basins b on b.fid = r.id
          where r.minx <= ? and r.maxx >= ? and r.miny <= ? and r.maxy >= ?`,
      ),
      // Upstream of a segment, orders below a floor left out, at most a
      // limit of rows (-1: none), for walkWithinCap. The LIMIT is inside the
      // CTE, where it stops the walk; outside it would only cut the result.
      // `union`, not `union all`: a cycle in a rebuilt layer would otherwise
      // walk forever, and node:sqlite blocks the event loop while it does.
      upstream: db.prepare(
        `with recursive up(id, fid, stream_order) as (
           select id, fid, stream_order from flow_network where fid = ?
           union
           select f.id, f.fid, f.stream_order
             from flow_network f join up on f.flows_into = up.id
            where f.stream_order >= ?
           limit ?
         )
         select fid, stream_order from up`,
      ),
      // Every kept segment in one statement: one `get` per fid was ~75 ms
      // for 3,700 segments of the Grose, this ~9 ms.
      segments: db.prepare(
        `select f.fid, f.geom, f.catchment_end_km2, f.stream_order
           from json_each(?) j join flow_network f on f.fid = j.value`,
      ),
    };
  } catch (err) {
    db.close();
    throw err;
  }
}

async function download(): Promise<FlowNetworkLayer> {
  const bucket = getEnv().S3_BUCKET_TOPO;
  if (!bucket) throw new Error("S3_BUCKET_TOPO is not set");
  const object = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: FLOW_NETWORK_KEY }),
  );
  if (!object.Body) throw new Error("S3 returned no body for the flow network");
  const body = object.Body as Readable;
  // Named for the object's version, so a restart (nodemon restarts on every
  // save) opens the copy it already has instead of leaving it behind and
  // downloading another. Only a whole file ever has this name: it is
  // written under another and renamed when complete.
  const path = layerPath(object.ETag);
  if (existsSync(path)) {
    body.destroy();
    return openFlowNetwork(path, object.ETag);
  }
  const part = `${path}.${randomUUID()}.part`;
  try {
    await pipeline(body, createWriteStream(part));
    await rename(part, path).catch(async (err) => {
      // Another process finished the same version first; theirs will do.
      if (!existsSync(path)) throw err;
      await unlink(part);
    });
    return openFlowNetwork(path, object.ETag);
  } catch (err) {
    await unlink(part).catch(() => {});
    throw err;
  }
}

/** Where a version of the layer lives on disk; one with no ETag is never reused. */
function layerPath(etag: string | undefined): string {
  const version = etag
    ? createHash("sha256").update(etag).digest("hex").slice(0, 32)
    : randomUUID();
  return join(tmpdir(), `logjam-flow-network-${version}.gpkg`);
}

function retire(old: FlowNetworkLayer) {
  // Later, not now: a request that was handed this layer before the swap
  // still has its synchronous queries to run, and those all run before the
  // next turn of the event loop.
  setImmediate(() => {
    // A throw here is uncaught, and would take the API down with it.
    if (old.db.isOpen) old.db.close();
    // The same version downloaded twice is one file, still in use.
    if (old.path !== layer?.path) unlink(old.path).catch(() => {});
  });
}

/** One download shared by every request waiting on it. */
function load(): Promise<FlowNetworkLayer> {
  loading ??= download().finally(() => {
    loading = null;
  });
  return loading;
}

/**
 * Swap in a rebuilt layer if S3 has one. Serves the old one meanwhile, and
 * keeps it if the check or the download fails: a layer that worked a minute
 * ago is better than a 503.
 */
async function refresh(current: FlowNetworkLayer) {
  try {
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: getEnv().S3_BUCKET_TOPO,
        Key: FLOW_NETWORK_KEY,
      }),
    );
    if (head.ETag === current.etag) return;
    const next = await load();
    if (layer === current && next !== current) {
      layer = next;
      retire(current);
      logger.info({ flowNetwork: "reloaded" }, "flow_network_reloaded");
    } else if (next !== layer) {
      // Forgotten while it downloaded (forgetFlowNetwork). Never the layer
      // being served, which a second download of the same file would be.
      retire(next);
    }
  } catch (err) {
    logger.warn(
      { flowNetwork: "recheck-failed", err: safeErrorForLog(err) },
      "flow_network_recheck_failed",
    );
  }
}

/**
 * The open layer, loaded on first use. A layer that is not there (no bucket,
 * no object yet) is a 503, and is remembered for RETRY_MS: every click in the
 * meantime would otherwise download, or fail to, all over again.
 */
async function currentLayer(): Promise<FlowNetworkLayer> {
  if (layer) {
    if (!refreshing && Date.now() - layer.checkedAt >= RECHECK_MS) {
      layer.checkedAt = Date.now();
      refreshing = refresh(layer).finally(() => {
        refreshing = null;
      });
    }
    return layer;
  }
  if (failedAt !== null && Date.now() - failedAt < RETRY_MS) {
    throw new AppError(503, UNAVAILABLE);
  }
  try {
    layer = await load();
    failedAt = null;
    return layer;
  } catch (err) {
    failedAt = Date.now();
    logger.warn(
      { flowNetwork: "unavailable", err: safeErrorForLog(err) },
      "flow_network_unavailable",
    );
    throw new AppError(503, UNAVAILABLE);
  }
}

/** Test seam: the layer is process-wide, and so is its five-minute memory. */
export function forgetFlowNetwork({ keepFile = false } = {}) {
  if (layer) {
    if (layer.db.isOpen) layer.db.close();
    // keepFile: as a restart leaves it.
    if (!keepFile) unlink(layer.path).catch(() => {});
  }
  layer = null;
  loading = null;
  refreshing = null;
  failedAt = null;
}

/** Six decimals is about 0.1 m, and an upstream answer can carry 4,000 lines. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const roundLine = (line: Position[]): [number, number][] =>
  line.map(([lon, lat]) => [round(lon), round(lat)]);

function covered({ basins }: FlowNetworkLayer, point: Position): boolean {
  const [lon, lat] = point;
  return basins
    .all(lon, lon, lat, lat)
    .some((row) => inPolygons(gpkgPolygons(row.geom as Uint8Array), point));
}

function upstreamOf(
  { upstream, segments }: FlowNetworkLayer,
  fid: number,
  head: { line: Position[]; catchmentKm2: number; streamOrder: number },
): FlowNetworkUpstream {
  const { kept, trimmedBelowOrder } = walkWithinCap(
    (minOrder, limit) =>
      upstream.all(fid, minOrder, limit ?? -1).map((row) => ({
        fid: Number(row.fid),
        streamOrder: Number(row.stream_order),
      })),
    head.streamOrder,
    FLOW_NETWORK_UPSTREAM_CAP,
  );
  const features: FlowNetworkSegmentFeature[] = [];
  const lines: Position[][] = [];
  const rows = segments.all(JSON.stringify(kept.map((k) => k.fid)));
  for (const row of rows) {
    const streamOrder = Number(row.stream_order);
    let line = head.line;
    let catchmentKm2 = head.catchmentKm2;
    if (Number(row.fid) !== fid) {
      line = gpkgLineString(row.geom as Uint8Array);
      catchmentKm2 = Number(row.catchment_end_km2);
    }
    if (line.length === 0) continue;
    // The bbox is of the rounded lines, so that it holds what is sent.
    const coordinates = roundLine(line);
    lines.push(coordinates);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: { catchmentKm2, streamOrder },
    });
  }
  return {
    lines: { type: "FeatureCollection", features },
    // The snapped segment is always in the walk, so there is always a line.
    bbox: bboxOf(lines)!,
    ...(trimmedBelowOrder !== undefined && { trimmedBelowOrder }),
  };
}

/** What drains through the creek nearest to a point. */
export async function lookupFlowNetwork(
  point: Position,
  withUpstream: boolean,
): Promise<FlowNetworkLookup> {
  // Synchronous from here on, so a swap cannot close the layer part-way
  // through (see retire).
  return lookupIn(await currentLayer(), point, withUpstream);
}

/** The lookup against an open layer. */
export function lookupIn(
  current: FlowNetworkLayer,
  point: Position,
  withUpstream: boolean,
): FlowNetworkLookup {
  const attribution = NSW_5M.credit;
  const { west, south, east, north } = boxAround(point, FLOW_NETWORK_SNAP_M);
  const candidates = current.candidates
    .all(east, west, north, south)
    .flatMap((row) => {
      const line = gpkgLineString(row.geom as Uint8Array);
      const nearest = nearestOnLine(line, point);
      if (!nearest) return [];
      return [
        {
          fid: Number(row.fid),
          line,
          nearest,
          distanceM: nearest.distanceM,
          catchmentKm2: blend(
            Number(row.catchment_start_km2),
            Number(row.catchment_end_km2),
            nearest.fraction,
          ),
          streamOrder: Number(row.stream_order),
        },
      ];
    });
  const choice = chooseCreek(candidates);
  if (!choice) {
    return {
      status: covered(current, point) ? "no-creek" : "not-covered",
      attribution,
    };
  }
  const { chosen, biggerNearby } = choice;
  const [longitude, latitude] = chosen.nearest.position;
  return {
    status: "found",
    snapped: { longitude: round(longitude), latitude: round(latitude) },
    distanceM: Math.round(chosen.distanceM * 10) / 10,
    catchmentKm2: chosen.catchmentKm2,
    streamOrder: chosen.streamOrder,
    ...(biggerNearby && {
      biggerNearby: { catchmentKm2: biggerNearby.catchmentKm2 },
    }),
    ...(withUpstream && {
      upstream: upstreamOf(current, chosen.fid, {
        line: lineDownTo(chosen.line, chosen.nearest),
        catchmentKm2: chosen.catchmentKm2,
        streamOrder: chosen.streamOrder,
      }),
    }),
    attribution,
  };
}
