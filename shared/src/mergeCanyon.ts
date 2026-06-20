// Per-field canyon merge with explicit precedence. Moved from
// frontend/src/csvImport/mergeCanyon.ts and generalized from a single
// "keepExisting | useCsv" policy to a per-field policy map so the server can
// enforce the same rules the client previews.
//
// Invariants (preserved from the original):
// - name / latitude / longitude are immutable: always keep existing.
// - altNames and attributes.sources are always unioned (never a conflict,
//   never discard data).
// - For any other field: if one side is absent take the other (union, never
//   discard data); if both sides are present, defer to policy[field].

// Fields the policy can govern. name/lat/lng are intentionally excluded — they
// are immutable on merge.
export type MergeableField =
  | "vGrade"
  | "aGrade"
  | "commitment"
  | "quality"
  | "numAbseils"
  | "longestAbseil"
  | "hours"
  | "notes";

const MERGEABLE_FIELDS: MergeableField[] = [
  "vGrade",
  "aGrade",
  "commitment",
  "quality",
  "numAbseils",
  "longestAbseil",
  "hours",
  "notes",
];

export type CanyonMergePolicy = Record<
  MergeableField,
  "keepExisting" | "useIncoming"
>;

// Defaults bias to keeping existing data: existing rows are often the
// authoritative RopeWiki copy. Users flip any field to useIncoming via the
// merge-settings accordion.
export const DEFAULT_CANYON_MERGE_POLICY: CanyonMergePolicy = {
  vGrade: "keepExisting",
  aGrade: "keepExisting",
  commitment: "keepExisting",
  quality: "keepExisting",
  numAbseils: "keepExisting",
  longestAbseil: "keepExisting",
  hours: "keepExisting",
  notes: "keepExisting",
};

// Minimal structural shapes so this module stays free of app-specific types.
// Both the frontend BulkCanyonInput and the Prisma Canyon row satisfy these.
export type CanyonMergeAttributes = {
  sources?: [string, string][];
} & Record<string, unknown>;

export type ExistingCanyonForMerge = {
  name: string;
  latitude: number;
  longitude: number;
  altNames?: string[] | null;
  attributes?: Record<string, unknown> | null;
} & Partial<Record<MergeableField, unknown>>;

export type IncomingCanyonForMerge = {
  name?: string;
  latitude?: number;
  longitude?: number;
  altNames?: string[] | null;
  attributes?: Record<string, unknown> | null;
} & Partial<Record<MergeableField, unknown>>;

export type MergedCanyon = {
  name: string;
  latitude: number;
  longitude: number;
  altNames: string[];
  attributes: Record<string, unknown>;
} & Partial<Record<MergeableField, unknown>>;

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

function mergeSources(
  existing: [string, string][] | undefined,
  incoming: [string, string][] | undefined,
): [string, string][] | undefined {
  if (!existing?.length && !incoming?.length) return undefined;
  const merged = [...(existing ?? [])];
  for (const [label, url] of incoming ?? []) {
    if (!merged.some(([, existingUrl]) => existingUrl === url)) {
      merged.push([label, url]);
    }
  }
  return merged.length ? merged : undefined;
}

export function mergeCanyon(
  existing: ExistingCanyonForMerge,
  incoming: IncomingCanyonForMerge,
  policy: CanyonMergePolicy,
): MergedCanyon {
  const merged: MergedCanyon = {
    // name / lat / lng immutable: existing wins.
    name: existing.name,
    latitude: existing.latitude,
    longitude: existing.longitude,
    altNames: [],
    attributes: {},
  };

  // Scalar mergeable fields.
  for (const field of MERGEABLE_FIELDS) {
    const existingValue = existing[field];
    const incomingValue = incoming[field];
    const hasExisting = isPresent(existingValue);
    const hasIncoming = isPresent(incomingValue);

    if (hasExisting && hasIncoming) {
      merged[field] =
        policy[field] === "keepExisting" ? existingValue : incomingValue;
    } else if (hasIncoming) {
      merged[field] = incomingValue;
    } else {
      merged[field] = existingValue ?? null;
    }
  }

  // altNames: always union with dedup.
  merged.altNames = unionStrings(existing.altNames, incoming.altNames);

  // attributes: shallow per-key merge under policy default (keepExisting for
  // an unmapped attribute key); attributes.sources always unioned.
  const existingAttributes = (existing.attributes ?? {}) as Record<
    string,
    unknown
  >;
  const incomingAttributes = (incoming.attributes ?? {}) as Record<
    string,
    unknown
  >;
  const mergedAttributes: Record<string, unknown> = {};

  const allKeys = new Set([
    ...Object.keys(existingAttributes),
    ...Object.keys(incomingAttributes),
  ]);
  for (const key of allKeys) {
    if (key === "sources") continue; // handled below as a union
    const hasExisting =
      key in existingAttributes && isPresent(existingAttributes[key]);
    const hasIncoming =
      key in incomingAttributes && isPresent(incomingAttributes[key]);
    if (hasExisting && hasIncoming) {
      // Attribute keys aren't in the typed policy map; default to keepExisting,
      // matching DEFAULT_CANYON_MERGE_POLICY's conservative bias.
      mergedAttributes[key] = existingAttributes[key];
    } else if (hasIncoming) {
      mergedAttributes[key] = incomingAttributes[key];
    } else {
      mergedAttributes[key] = existingAttributes[key];
    }
  }

  const sources = mergeSources(
    (existingAttributes as CanyonMergeAttributes).sources,
    (incomingAttributes as CanyonMergeAttributes).sources,
  );
  if (sources) mergedAttributes.sources = sources;

  merged.attributes = mergedAttributes;

  return merged;
}
