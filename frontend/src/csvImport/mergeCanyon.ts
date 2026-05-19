import type { TCanyon } from "../canyonUtils";
import type { BulkCanyonInput } from "../canyonUtils";

export type ConflictPolicy = "keepExisting" | "useCsv";

const SCALAR_FIELDS = [
  "name", "latitude", "longitude",
  "vGrade", "aGrade", "commitment", "quality", "wetsuits",
  "numAbseils", "longestAbseil", "hours", "notes",
] as const;

function isPresent(v: unknown): boolean {
  return v != null && v !== "" && !(typeof v === "number" && isNaN(v));
}

export function mergeCanyon(
  existing: TCanyon,
  incoming: BulkCanyonInput,
  policy: ConflictPolicy,
): BulkCanyonInput {
  const merged: BulkCanyonInput = {
    name: existing.name,
    latitude: existing.latitude,
    longitude: existing.longitude,
  };

  for (const field of SCALAR_FIELDS) {
    const existingVal = existing[field as keyof TCanyon] as unknown;
    const incomingVal = incoming[field as keyof BulkCanyonInput] as unknown;

    const hasExisting = isPresent(existingVal);
    const hasIncoming = isPresent(incomingVal);

    if (hasExisting && hasIncoming) {
      (merged as Record<string, unknown>)[field] =
        policy === "keepExisting" ? existingVal : incomingVal;
    } else if (hasIncoming) {
      (merged as Record<string, unknown>)[field] = incomingVal;
    } else {
      (merged as Record<string, unknown>)[field] = existingVal ?? null;
    }
  }

  // altNames: always union-merge with dedup
  const existingAltNames = existing.altNames ?? [];
  const incomingAltNames = incoming.altNames ?? [];
  const allNames = [...existingAltNames];
  for (const n of incomingAltNames) {
    if (!allNames.includes(n)) allNames.push(n);
  }
  merged.altNames = allNames;

  // attributes: shallow merge per top-level key, policy per key
  const existingAttrs = (existing.attributes ?? {}) as Record<string, unknown>;
  const incomingAttrs = (incoming.attributes ?? {}) as Record<string, unknown>;
  const mergedAttrs: Record<string, unknown> = {};

  const allKeys = new Set([
    ...Object.keys(existingAttrs),
    ...Object.keys(incomingAttrs),
  ]);

  for (const key of allKeys) {
    const hasE = key in existingAttrs && isPresent(existingAttrs[key]);
    const hasI = key in incomingAttrs && isPresent(incomingAttrs[key]);

    if (hasE && hasI) {
      mergedAttrs[key] =
        policy === "keepExisting" ? existingAttrs[key] : incomingAttrs[key];
    } else if (hasI) {
      mergedAttrs[key] = incomingAttrs[key];
    } else {
      mergedAttrs[key] = existingAttrs[key];
    }
  }

  merged.attributes = mergedAttrs;

  return merged;
}
