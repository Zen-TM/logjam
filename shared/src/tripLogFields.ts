export type TripLogCustomFieldType =
  | "string"
  | "integer"
  | "float"
  | "date"
  | "boolean";

export type TripLogCustomFieldDef = {
  key: string;
  label: string;
  type: TripLogCustomFieldType;
  // Optional inclusive bounds, only meaningful (and only valid) for
  // integer/float fields. Present together or not at all. When set, the
  // canyon filter renders a double-ended range slider instead of op+value.
  min?: number;
  max?: number;
};

export const CUSTOM_FIELD_TYPES: {
  value: TripLogCustomFieldType;
  label: string;
}[] = [
  { value: "string", label: "Text" },
  { value: "integer", label: "Integer" },
  { value: "float", label: "Decimal" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / No" },
];

export const VALID_CUSTOM_FIELD_TYPES = new Set<string>([
  "string",
  "integer",
  "float",
  "date",
  "boolean",
]);

/**
 * Display label for a custom field. Bounded integer/float fields get their
 * range appended in brackets (e.g. "Temperature (1-5)") so the constraint is
 * visible everywhere the field is shown, without polluting the stored label.
 */
export function customFieldDisplayLabel(def: TripLogCustomFieldDef): string {
  if (def.min != null && def.max != null) {
    return `${def.label} (${def.min}-${def.max})`;
  }
  return def.label;
}

export function makeCustomFieldKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function coerceFieldValue(value: string, type: TripLogCustomFieldType): unknown {
  if (value === "") return null;
  if (type === "integer") return parseInt(value, 10);
  if (type === "float") return parseFloat(value);
  if (type === "boolean") return value === "true";
  return value;
}

/**
 * Raw form state for the "Add Custom Field" sub-form. Both CanyonDialog and
 * TripLogDialog feed this into `buildCustomFieldDef` to get a validated
 * `TripLogCustomFieldDef` or a user-facing error string.
 */
export type CustomFieldDraft = {
  label: string;
  type: TripLogCustomFieldType;
  bounded: boolean;
  min: string;
  max: string;
};

/**
 * Validate a custom-field draft and produce a `TripLogCustomFieldDef` ready
 * for persistence, or a user-facing error string. Pure — no side effects.
 */
export function buildCustomFieldDef(
  draft: CustomFieldDraft,
  existingDefs: TripLogCustomFieldDef[],
): { def: TripLogCustomFieldDef } | { error: string } {
  const label = draft.label.trim();
  if (!label) return { error: "Label is required." };

  const key = makeCustomFieldKey(label);
  if (existingDefs.some((d) => d.key === key)) {
    return { error: `A field with the key "${key}" already exists.` };
  }

  const isNumeric = draft.type === "integer" || draft.type === "float";
  let bounds: { min: number; max: number } | null = null;

  if (isNumeric && draft.bounded) {
    if (draft.min.trim() === "" || draft.max.trim() === "") {
      return { error: "Both min and max are required for a bounded field." };
    }
    const min =
      draft.type === "integer"
        ? parseInt(draft.min, 10)
        : parseFloat(draft.min);
    const max =
      draft.type === "integer"
        ? parseInt(draft.max, 10)
        : parseFloat(draft.max);
    if (!isFinite(min) || !isFinite(max)) {
      return { error: "Min and max must be valid numbers." };
    }
    if (min >= max) {
      return { error: "Minimum must be less than maximum." };
    }
    bounds = { min, max };
  }

  return {
    def: { key, label, type: draft.type, ...(bounds ?? {}) },
  };
}

export function isTripLogCustomFieldDef(v: unknown): v is TripLogCustomFieldDef {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  if (
    typeof c.key !== "string" ||
    c.key.length === 0 ||
    typeof c.label !== "string" ||
    c.label.length === 0 ||
    !VALID_CUSTOM_FIELD_TYPES.has(c.type as string)
  ) {
    return false;
  }
  // Bounds are optional, but if either is present both must be valid finite
  // numbers with min < max, only on numeric field types (integers when
  // type === "integer"). Fail loud rather than silently dropping.
  const hasMin = c.min !== undefined;
  const hasMax = c.max !== undefined;
  if (hasMin || hasMax) {
    if (c.type !== "integer" && c.type !== "float") return false;
    if (typeof c.min !== "number" || typeof c.max !== "number") return false;
    if (!Number.isFinite(c.min) || !Number.isFinite(c.max)) return false;
    if (c.min >= c.max) return false;
    if (c.type === "integer" && (!Number.isInteger(c.min) || !Number.isInteger(c.max))) {
      return false;
    }
  }
  return true;
}
