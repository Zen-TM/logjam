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
