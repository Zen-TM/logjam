// Pure idempotency-key computation for file imports. No I/O, no Prisma — these
// are deterministic hash functions suitable for unit testing.

import { createHash } from "crypto";
import { normalizeCanyonName } from "@logjam/shared";

/**
 * Canyon import key: deterministic from the normalized name + rounded coords.
 * Two CSV rows that refer to the same canyon (modulo formatting noise) produce
 * the same key, so re-import is idempotent.
 */
export function canyonImportKey(name: string, latitude: number, longitude: number): string {
  const base = normalizeCanyonName(name).base;
  const coordStr = latitude.toFixed(5) + "," + longitude.toFixed(5);
  const hash = createHash("sha256").update(base + "|" + coordStr).digest("hex");
  return "csv:" + hash;
}

/**
 * Recursively sort object keys for stable JSON serialization. Arrays are
 * preserved in order; nested objects get their keys sorted.
 */
export function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableJson(v)).join(",") + "]";
  }
  const sorted = Object.keys(value as Record<string, unknown>).sort();
  const parts = sorted.map((k) => JSON.stringify(k) + ":" + stableJson((value as Record<string, unknown>)[k]));
  return "{" + parts.join(",") + "}";
}

/**
 * Content hash for a single trip row. Inputs only (not resolution outputs like
 * canyonId or displayName) so the hash is stable across re-imports where
 * resolution may change.
 */
export function tripContentHash(
  sourceCanyonName: string,
  isoDate: string,
  notes: string | null | undefined,
  customFields: Record<string, unknown> | null | undefined,
): string {
  const payload = sourceCanyonName + "|" + isoDate + "|" + (notes ?? "") + "|" + stableJson(customFields ?? {});
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Trip import key: content hash + occurrence index for disambiguating
 * same-content rows (e.g. two trips to the same canyon on the same day).
 */
export function tripImportKey(contentHash: string, occurrence: number): string {
  return "trip:" + contentHash + ":" + occurrence;
}

/**
 * Assign occurrence indexes to an ordered list of trips, grouping by content
 * hash. Returns an array parallel to the input with each element's
 * `{ contentHash, occurrence, importKey }`.
 */
export function assignTripImportKeys(
  trips: Array<{
    sourceCanyonName: string;
    date: string;
    notes?: string | null;
    customFields?: Record<string, unknown> | null;
  }>,
): Array<{ contentHash: string; occurrence: number; importKey: string }> {
  const occurrenceCounts = new Map<string, number>();
  return trips.map((trip) => {
    const hash = tripContentHash(trip.sourceCanyonName, trip.date, trip.notes, trip.customFields);
    const occurrence = occurrenceCounts.get(hash) ?? 0;
    occurrenceCounts.set(hash, occurrence + 1);
    return {
      contentHash: hash,
      occurrence,
      importKey: tripImportKey(hash, occurrence),
    };
  });
}
