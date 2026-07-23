// Pure pieces of the Protomaps region-clip endpoint (stage4a §7): request
// validation/caps and the short-lived opaque-token store. Kept free of
// express/S3 so the privacy-relevant logic is unit-testable.
//
// PRIVACY: a region bbox is canyon-area knowledge. It exists transiently in
// the POST body (redacted from logs — see redactPaths in lib/logger.ts) and
// in this process's memory until the clip is streamed or expires. It must
// never appear in URLs, filenames, error messages, or persisted storage.
import { randomUUID } from "crypto";
import { regionEdgesKm, type RegionBbox } from "@logjam/shared";

/** Bounds of the NSW/ACT archive extract — requests must intersect. */
export const ARCHIVE_BOUNDS: RegionBbox = {
  west: 140.9,
  south: -37.6,
  east: 153.7,
  north: -28.0,
};

/** Server-side caps (stage4a §7.2). */
export const MAX_CLIP_AREA_KM2 = 1600; // 40×40 km
export const MAX_CLIP_ZOOM = 15;
export const MAX_CLIP_OUTPUT_BYTES = 80 * 1024 * 1024;
export const CLIP_TOKEN_TTL_MS = 120_000;

export type RegionClipRequest = {
  bbox: RegionBbox;
  maxzoom: number;
};

export type RegionClipValidation =
  | { ok: true; value: RegionClipRequest }
  | { ok: false; error: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate a clip request body. Error strings are static — they must never
 * echo the submitted coordinates (they end up in client-visible responses,
 * which is fine, but also potentially in logs).
 */
export function validateRegionClipRequest(body: unknown): RegionClipValidation {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return { ok: false, error: "Invalid body" };
  const { west, south, east, north } = b;
  if (
    !isFiniteNumber(west) ||
    !isFiniteNumber(south) ||
    !isFiniteNumber(east) ||
    !isFiniteNumber(north)
  ) {
    return { ok: false, error: "Region bounds must be numbers" };
  }
  if (!(west < east) || !(south < north)) {
    return { ok: false, error: "Region bounds are empty or inverted" };
  }
  const bbox: RegionBbox = { west, south, east, north };

  // Must intersect the archive extract.
  if (
    east < ARCHIVE_BOUNDS.west ||
    west > ARCHIVE_BOUNDS.east ||
    north < ARCHIVE_BOUNDS.south ||
    south > ARCHIVE_BOUNDS.north
  ) {
    return { ok: false, error: "Region is outside the map archive coverage" };
  }

  const [widthKm, heightKm] = regionEdgesKm(bbox);
  if (widthKm * heightKm > MAX_CLIP_AREA_KM2) {
    return { ok: false, error: "Region is too large" };
  }

  let maxzoom = MAX_CLIP_ZOOM;
  if (b.maxzoom !== undefined) {
    if (
      !isFiniteNumber(b.maxzoom) ||
      !Number.isInteger(b.maxzoom) ||
      b.maxzoom < 1 ||
      b.maxzoom > MAX_CLIP_ZOOM
    ) {
      return { ok: false, error: "Invalid maxzoom" };
    }
    maxzoom = b.maxzoom;
  }

  return { ok: true, value: { bbox, maxzoom } };
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
  issue(entry: Omit<ClipTokenEntry, "expiresAt">): { token: string; expiresAt: number };
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
