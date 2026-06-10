import type { TripLogCustomFieldDef } from "@logjam/shared";

/**
 * Resolve the string form of a custom field's value for an editable form.
 *
 * Unset boolean fields default to "false" (rather than "") so the rendered
 * checkbox (unchecked) and the value persisted on save (coerceFieldValue ->
 * false) agree — an unset boolean and an explicit "No" collapse to the same
 * state, matching conventional checkbox semantics (UX-004).
 *
 * Unset fields of any other type default to "".
 */
export function getFieldValue(
  fieldValues: Record<string, string>,
  defs: TripLogCustomFieldDef[],
  key: string,
): string {
  const stored = fieldValues[key];
  if (stored != null) return stored;
  const def = defs.find((d) => d.key === key);
  return def?.type === "boolean" ? "false" : "";
}
