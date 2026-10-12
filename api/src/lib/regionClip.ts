// Pure pieces of the Protomaps region-clip endpoint (stage4a §7): request
// validation/caps and the short-lived opaque-token store. Kept free of
// express/S3 so the privacy-relevant logic is unit-testable.
//
// PRIVACY: a region bbox is place-area knowledge. It exists transiently in
// the POST body (redacted from logs — see redactPaths in lib/logger.ts) and
// in this process's memory until the clip is streamed or expires. It must
// never appear in URLs, filenames, error messages, or persisted storage.
import { randomUUID } from "crypto";
import { AppError, malformed } from "../middleware/errorHandler";
import {
  say,
  DEM_SOURCES,
  MAX_REGION_AREA_KM2,
  NSW_CONTOURS,
  regionEdgesKm,
  type RegionBbox,
} from "@logjam/shared";

/** Bounds of the NSW/ACT archive extract — requests must intersect. */
export const ARCHIVE_BOUNDS: RegionBbox = {
  west: 140.9,
  south: -37.6,
  east: 153.7,
  north: -28.0,
};

/** Server-side caps (stage4a §7.2). */
/** Re-exported from shared so the client offers exactly what this accepts. */
export const MAX_CLIP_AREA_KM2 = MAX_REGION_AREA_KM2; // 40×40 km
export const MAX_CLIP_ZOOM = 15;
export const MAX_CLIP_OUTPUT_BYTES = 80 * 1024 * 1024;
export const CLIP_TOKEN_TTL_MS = 120_000;

export type RegionClipRequest = {
  bbox: RegionBbox;
  maxzoom: number;
  /** Shallowest zoom kept; the archive's own when absent. */
  minzoom?: number;
  /**
   * Set when the clip is of a DEM or contour archive, not the basemap. Its
   * zooms are pinned to the ones its reader uses, so a saved area never holds
   * a depth nothing reads.
   */
  archive?: { id: string; archivePath: string };
};

/** Where the map Logjam holds ends. */
const AREA_OUTSIDE = say`That area is outside the map Logjam has. Choose one in NSW.`;
/**
 * Logjam GPS builds from before the server's sentence was shown as it is look
 * for "too large" in it to tell this refusal from the one above; keep those
 * words while such a build is supported (regionClip.unit.test.ts).
 */
export const AREA_TOO_LARGE = say`That area is too large. Choose one up to ${Math.round(Math.sqrt(MAX_REGION_AREA_KM2))} km across.`;

export type RegionClipValidation =
  | { ok: true; value: RegionClipRequest }
  | { ok: false; error: AppError };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate a clip request body. Sentences and details are static — they must
 * never echo the submitted coordinates (they end up in client-visible
 * responses, which is fine, but also potentially in logs).
 */
export function validateRegionClipRequest(body: unknown): RegionClipValidation {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object")
    return { ok: false, error: malformed("Invalid body") };
  const { west, south, east, north } = b;
  if (
    !isFiniteNumber(west) ||
    !isFiniteNumber(south) ||
    !isFiniteNumber(east) ||
    !isFiniteNumber(north)
  ) {
    return { ok: false, error: malformed("Region bounds must be numbers") };
  }
  if (!(west < east) || !(south < north)) {
    return {
      ok: false,
      error: malformed("Region bounds are empty or inverted"),
    };
  }
  const bbox: RegionBbox = { west, south, east, north };

  // Must intersect the archive extract.
  if (
    east < ARCHIVE_BOUNDS.west ||
    west > ARCHIVE_BOUNDS.east ||
    north < ARCHIVE_BOUNDS.south ||
    south > ARCHIVE_BOUNDS.north
  ) {
    return { ok: false, error: new AppError(400, AREA_OUTSIDE) };
  }

  const [widthKm, heightKm] = regionEdgesKm(bbox);
  if (widthKm * heightKm > MAX_CLIP_AREA_KM2) {
    return { ok: false, error: new AppError(400, AREA_TOO_LARGE) };
  }

  let maxzoom = MAX_CLIP_ZOOM;
  if (b.maxzoom !== undefined) {
    if (
      !isFiniteNumber(b.maxzoom) ||
      !Number.isInteger(b.maxzoom) ||
      b.maxzoom < 1 ||
      b.maxzoom > MAX_CLIP_ZOOM
    ) {
      return { ok: false, error: malformed("Invalid maxzoom") };
    }
    maxzoom = b.maxzoom;
  }

  if (b.demSourceId !== undefined) {
    const dem = DEM_SOURCES.find((source) => source.id === b.demSourceId);
    if (!dem || dem.archivePath == null) {
      return { ok: false, error: malformed("Unknown elevation source") };
    }
    return {
      ok: true,
      value: {
        bbox,
        minzoom: dem.sampleZoom,
        maxzoom: dem.sampleZoom,
        archive: { id: dem.id, archivePath: dem.archivePath },
      },
    };
  }

  if (b.contours === true) {
    return {
      ok: true,
      value: {
        bbox,
        minzoom: NSW_CONTOURS.minzoom,
        maxzoom: NSW_CONTOURS.maxzoom,
        archive: NSW_CONTOURS,
      },
    };
  }

  return { ok: true, value: { bbox, maxzoom } };
}

/**
 * Argv for `pmtiles extract`. An `s3://bucket/key` archive has to be split:
 * go-pmtiles only reads a bucket through `--bucket`, and given the whole URI
 * as <input> it opens it as a local path and exits 1 — which made every region
 * clip a 502 in prod, where the archive is in S3, while local dev (a file
 * path) worked. Guard: `regionClip.unit.test.ts` ("pmtilesExtractArgs").
 */
export function pmtilesExtractArgs(
  archiveUri: string,
  outPath: string,
  bboxArg: string,
  maxzoom: number,
  awsRegion: string,
  minzoom?: number,
): string[] {
  const s3 = /^s3:\/\/([^/]+)\/(.+)$/.exec(archiveUri);
  return [
    "extract",
    s3 ? s3[2] : archiveUri,
    outPath,
    // The region rides the URL so the extract does not depend on AWS_REGION
    // being set in the container's environment.
    ...(s3 ? [`--bucket=s3://${s3[1]}?region=${awsRegion}`] : []),
    `--bbox=${bboxArg}`,
    `--maxzoom=${maxzoom}`,
    ...(minzoom != null ? [`--minzoom=${minzoom}`] : []),
  ];
}

// ── Token store ──────────────────────────────────────────────────────────────
//
// SINGLE-INSTANCE ASSUMPTION (same as ARCH-007 in middleware/rateLimit.ts):
// the token→file map is in-process and the temp file is instance-local, so
// POST and GET must hit the same process. True today (single EB container).
// If the API ever scales out, this endpoint needs rework (sticky sessions or
// a real export flow) — do not band-aid it.

export interface ClipTokenEntry {
  path: string;
  userId: string;
  sizeBytes: number;
  expiresAt: number;
}

export interface ClipTokenStore {
  issue(entry: Omit<ClipTokenEntry, "expiresAt">): {
    token: string;
    expiresAt: number;
  };
  /** Consume the token: returns and removes the entry when valid for userId. */
  take(token: string, userId: string, now?: number): ClipTokenEntry | null;
  /** Remove expired entries, returning their paths for file cleanup. */
  sweepExpired(now?: number): string[];
  size(): number;
}

export function createClipTokenStore(
  ttlMs: number = CLIP_TOKEN_TTL_MS,
): ClipTokenStore {
  const entries = new Map<string, ClipTokenEntry>();
  return {
    issue(entry) {
      const token = randomUUID();
      const expiresAt = Date.now() + ttlMs;
      entries.set(token, { ...entry, expiresAt });
      return { token, expiresAt };
    },
    take(token, userId, now = Date.now()) {
      const entry = entries.get(token);
      if (!entry) return null;
      if (entry.expiresAt <= now || entry.userId !== userId) {
        // Expired entries stay for the sweeper (file still needs deletion);
        // wrong-user access reveals nothing and does not consume the token.
        return null;
      }
      entries.delete(token);
      return entry;
    },
    sweepExpired(now = Date.now()) {
      const paths: string[] = [];
      for (const [token, entry] of entries) {
        if (entry.expiresAt <= now) {
          entries.delete(token);
          paths.push(entry.path);
        }
      }
      return paths;
    },
    size() {
      return entries.size;
    },
  };
}
