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
  return (
    typeof c.key === "string" &&
    c.key.length > 0 &&
    typeof c.label === "string" &&
    c.label.length > 0 &&
    VALID_CUSTOM_FIELD_TYPES.has(c.type as string)
  );
}
