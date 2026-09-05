// Per-field place merge with explicit precedence. Moved from
// frontend/src/csvImport/mergePlace.ts and generalized from a single
// "keepExisting | useCsv" policy to a per-field policy map so the server can
// enforce the same rules the client previews.
//
// Invariants (preserved verbatim through the places rework):
// - name / latitude / longitude are immutable: always keep existing.
// - altNames and the source list are always unioned (never a conflict, never
//   discard data).
// - For any other field: if one side is absent take the other (union, never
//   discard data); if both sides are present, defer to policy[field].
//
// WHAT CHANGED: the field list is no longer a hardcoded seven-entry union of
// grade columns. A place's mergeable fields are `notes` plus the KEYS of the
// definitions its type carries, so a user's own field merges under the same
// rules the grades always did — and a Campsite, which has no grades at all,
// merges its own fields rather than seven columns it does not have.
//
// A stored policy from before the rework is keyed by column name (`vGrade`);
// the forward migration rewrites those to field keys (`v_grade`). An
// unmigrated policy does not error, it silently falls back to the default for
// every field the user configured — which is why the migration does it rather
// than a lenient reader here.

import { asFieldValues, setFieldValues } from "./fieldValues.js";
import { SOURCES_FIELD_KEY, LEGACY_ATTRIBUTES_FIELD_KEY } from "./placeTypes.js";

/**
 * A field the policy can govern: a definition key, or one of the structural
 * fields below. name/lat/lng are intentionally absent — they are immutable on
 * merge, so there is nothing for a policy to decide.
 */
export type MergeableField = string;

/**
 * Mergeable fields that are NOT custom-field values.
 *
 * `_attributes` is the one non-scalar entry: it is merged per key rather than
 * wholesale (a key only one side has always lands, whatever the policy says),
 * and its policy entry decides only the per-key conflicts. Before it was a
 * policy entry those conflicts were hardcoded to keepExisting with no way out,
 * so a corrected spreadsheet could not repair a value it had already imported.
 *
 * `_sources` is deliberately NOT here: it is always unioned, never a conflict.
 */
export const STRUCTURAL_MERGEABLE_FIELDS: MergeableField[] = [
  "notes",
  LEGACY_ATTRIBUTES_FIELD_KEY,
];

/**
 * The fields a policy may govern for a place of a type carrying `defs`.
 *
 * The single source of the field list. Every other surface that needs to
 * enumerate the policy — the API's request re-validation, the stored-preference
 * normalizer, the frontend's switch labels — calls this rather than
 * redeclaring, because a redeclared list is a list that drifts.
 */
export function mergeableFieldsForDefs(
  defs: { key: string }[],
): MergeableField[] {
  return [...STRUCTURAL_MERGEABLE_FIELDS, ...defs.map((def) => def.key)];
}

export type PlaceMergePolicy = Record<
  MergeableField,
  "keepExisting" | "useIncoming"
>;

/**
 * Defaults bias to keeping existing data: existing rows are often the
 * authoritative RopeWiki copy. Users flip any field to useIncoming via the
 * merge-settings accordion.
 *
 * A field absent from a stored policy reads as `keepExisting` too (see
 * `mergePolicyFor`), so a policy saved before a field existed keeps behaving
 * the safe way rather than adopting whatever the import carries.
 */
export function defaultPlaceMergePolicy(
  fields: MergeableField[],
): PlaceMergePolicy {
  const policy: PlaceMergePolicy = {};
  for (const field of fields) policy[field] = "keepExisting";
  return policy;
}

function mergePolicyFor(
  policy: PlaceMergePolicy,
  field: MergeableField,
): "keepExisting" | "useIncoming" {
  return policy[field] === "useIncoming" ? "useIncoming" : "keepExisting";
}

// Minimal structural shapes so this module stays free of app-specific types.
// Both the frontend BulkPlaceInput and the Prisma Place row satisfy these.
export type ExistingPlaceForMerge = {
  name: string;
  latitude: number;
  longitude: number;
  altNames?: string[] | null;
  notes?: string | null;
  fieldValues?: unknown;
};

export type IncomingPlaceForMerge = {
  name?: string;
  latitude?: number;
  longitude?: number;
  altNames?: string[] | null;
  notes?: string | null;
  fieldValues?: unknown;
};

export type MergedPlace = {
  name: string;
  latitude: number;
  longitude: number;
  altNames: string[];
  notes?: string | null;
  fieldValues: Record<string, unknown>;
};

function isPresent(value: unknown): boolean {
  return (
    value != null &&
    value !== "" &&
    !(typeof value === "number" && Number.isNaN(value))
  );
}

function unionStrings(
  existing: string[] | null | undefined,
  incoming: string[] | null | undefined,
): string[] {
  const result = [...(existing ?? [])];
  for (const value of incoming ?? []) {
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

/** Source links, unioned by URL. Kept out of the policy on purpose: two
 *  citations of the same place are both true, so there is no conflict to
 *  resolve and nothing a user could usefully be asked. */
function mergeSources(
  existing: unknown,
  incoming: unknown,
): [string, string][] | undefined {
  const left = Array.isArray(existing) ? (existing as [string, string][]) : [];
  const right = Array.isArray(incoming) ? (incoming as [string, string][]) : [];
  if (!left.length && !right.length) return undefined;
  const merged = [...left];
  for (const entry of right) {
    if (!Array.isArray(entry)) continue;
    const [, url] = entry;
    if (!merged.some(([, existingUrl]) => existingUrl === url)) {
      merged.push(entry as [string, string]);
    }
  }
  return merged.length ? merged : undefined;
}

/** Shallow per-key merge: a key only one side has always lands; a key both
 *  sides have defers to `policy`. Used for the field values and for the
 *  legacy `_attributes` bag, which behave identically. */
function mergeRecords(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  decide: (key: string) => "keepExisting" | "useIncoming",
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
  for (const key of keys) {
    const hasExisting = key in existing && isPresent(existing[key]);
    const hasIncoming = key in incoming && isPresent(incoming[key]);
    if (hasExisting && hasIncoming) {
      merged[key] =
        decide(key) === "keepExisting" ? existing[key] : incoming[key];
    } else if (hasIncoming) {
      merged[key] = incoming[key];
    } else if (hasExisting) {
      merged[key] = existing[key];
    }
  }
  return merged;
}

export function mergePlace(
  existing: ExistingPlaceForMerge,
  incoming: IncomingPlaceForMerge,
  policy: PlaceMergePolicy,
): MergedPlace {
  const existingValues = asFieldValues(existing.fieldValues);
  const incomingValues = asFieldValues(incoming.fieldValues);

  // Field values, per key, under the policy entry for that key. The internal
  // `_`-prefixed entries are handled separately below — `_sources` unions and
  // `_attributes` merges under its own single policy entry — so they are
  // excluded here rather than treated as ordinary fields.
  const isInternal = (key: string) =>
    key === SOURCES_FIELD_KEY || key === LEGACY_ATTRIBUTES_FIELD_KEY;
  const userExisting: Record<string, unknown> = {};
  const userIncoming: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existingValues)) {
    if (!isInternal(key)) userExisting[key] = value;
  }
  for (const [key, value] of Object.entries(incomingValues)) {
    if (!isInternal(key)) userIncoming[key] = value;
  }

  let fieldValues = mergeRecords(userExisting, userIncoming, (key) =>
    mergePolicyFor(policy, key),
  );

  const sources = mergeSources(
    existingValues[SOURCES_FIELD_KEY],
    incomingValues[SOURCES_FIELD_KEY],
  );

  const legacy = mergeRecords(
    asFieldValues(existingValues[LEGACY_ATTRIBUTES_FIELD_KEY]),
    asFieldValues(incomingValues[LEGACY_ATTRIBUTES_FIELD_KEY]),
    // One switch governs every legacy attribute key. Per-key policy would mean
    // a UI over an open-ended key set the user invents at import time; the
    // whole bag moves together instead.
    () => mergePolicyFor(policy, LEGACY_ATTRIBUTES_FIELD_KEY),
  );

  fieldValues = setFieldValues(fieldValues, {
    [SOURCES_FIELD_KEY]: sources ?? null,
    [LEGACY_ATTRIBUTES_FIELD_KEY]: Object.keys(legacy).length ? legacy : null,
  });

  const hasExistingNotes = isPresent(existing.notes);
  const hasIncomingNotes = isPresent(incoming.notes);
  const notes =
    hasExistingNotes && hasIncomingNotes
      ? mergePolicyFor(policy, "notes") === "keepExisting"
        ? existing.notes
        : incoming.notes
      : hasIncomingNotes
        ? incoming.notes
        : (existing.notes ?? null);

  return {
    // name / lat / lng immutable: existing wins.
    name: existing.name,
    latitude: existing.latitude,
    longitude: existing.longitude,
    altNames: unionStrings(existing.altNames, incoming.altNames),
    notes,
    fieldValues,
  };
}
