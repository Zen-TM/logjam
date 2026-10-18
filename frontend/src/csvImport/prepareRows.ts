// The row-building half of the CSV import: a parsed file plus the user's column
// mapping becomes the rows the dialog reviews and posts. Separate from
// UnifiedImportDialog.tsx so a golden corpus can drive the real thing without
// rendering the dialog (csvImport/importCorpus.test.ts).
import {
  setFieldValues,
  SOURCES_FIELD_KEY,
  makeCustomFieldKey,
  coerceFieldValueStrict,
  type MatchResult,
  type TripLogCustomFieldDef,
  type TripLogCustomFieldType,
} from "@logjam/shared";
import type { BulkPlaceInput } from "../placeUtils";
import { ROLE_LABELS, GRADE_RANGES, type PlaceFieldRole } from "./placeColumns";
import type { ColumnRole } from "./detectColumns";
import { toIsoDate, type DateFormat } from "./detectDateFormat";
import { parseByRole, type MismatchKind } from "./placeValueParsers";
import { describeDroppedPlaceRow, describeDroppedTripRow } from "./rowSkip";

// Per-place-row prepared input, plus the raw file name string used as the
// match key and stable provenance.
export type PreparedPlaceRow = {
  rowIndex: number;
  sourceName: string;
  input: BulkPlaceInput;
};

// Per-trip-row prepared content. `sourcePlaceName` is the raw file string.
// `types` is free text split on ";" (each trimmed, empties dropped, deduped
// case-insensitively) — no enum validation.
export type PreparedTripRow = {
  rowIndex: number;
  sourcePlaceName: string;
  date: string;
  notes: string | null;
  types: string[];
  customFields: Record<string, unknown>;
};

// Split a CSV `type` cell into multiple trip types: ";"-separated, each part
// trimmed, empties dropped, deduped case-insensitively (first casing wins).
// A single value without ";" yields a one-element array.
function splitTripTypes(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

// Numeric place fields that are silently left empty when a cell can't be
// parsed. A non-empty-but-unparseable cell in one of these produces a per-field
// coercion warning surfaced in the import result.
const NUMERIC_WARN_ROLES = new Set<PlaceFieldRole>([
  "vGrade",
  "aGrade",
  "commitment",
  "quality",
  "numAbseils",
  "longestAbseil",
  "hours",
]);

// Why the cell was dropped, phrased so the user can act on it. Declared as a
// total Record over MismatchKind so adding a reason fails the build here rather
// than inheriting some other reason's wording (which would mischaracterise e.g.
// a quality of 0.5, a number outside the 1–5 range, as not being a number).
// Reasons the numeric parsers can't currently produce still get honest text:
// NUMERIC_WARN_ROLES is the only caller today, but the reason is the parser's
// to choose, not this map's.
const MISMATCH_EXPLANATIONS: Record<
  MismatchKind,
  (range: [number, number] | undefined) => string
> = {
  nonNumeric: () => "isn't a number",
  booleanish: () => "is a yes/no value, not a number",
  decimalInInt: () => "isn't a whole number",
  outOfRange: (range) =>
    range
      ? `is outside the accepted range ${range[0]}–${range[1]}`
      : "is outside the accepted range",
  scaleMismatch: (range) =>
    range
      ? `is above the accepted range ${range[0]}–${range[1]} — the file may use a different scale`
      : "is above the accepted range — the file may use a different scale",
  unparsableJson: () => "isn't valid JSON",
  unparsableArray: () => "isn't a valid list",
  mixedTypes: () => "doesn't match the other values in this column",
  emptyDominant: () => "couldn't be read",
};

function coercionWarning(
  role: PlaceFieldRole,
  raw: string,
  reason: MismatchKind,
): string {
  const label = ROLE_LABELS[role] ?? role;
  const explanation = MISMATCH_EXPLANATIONS[reason](GRADE_RANGES[role]);
  return `${label} "${raw}" ${explanation} — left empty`;
}

// Values that don't parse are dropped (left null) — the importer is additive and
// merge fills nulls, so a bad cell never blocks the row. Non-empty cells that
// fail to parse into a numeric field are collected as `warnings` so the result
// summary can tell the user which values were left empty.
export function buildPlaceInput(
  row: Record<string, string>,
  assignments: Record<string, PlaceFieldRole>,
): { input: BulkPlaceInput; warnings: string[] } {
  const input: BulkPlaceInput = { name: "", latitude: NaN, longitude: NaN };
  const values: Record<string, unknown> = {};
  const warnings: string[] = [];

  for (const [header, role] of Object.entries(assignments)) {
    if (role === "discard") continue;
    const raw = row[header] ?? "";
    const parsed = parseByRole(raw, role);
    const value: unknown = parsed.ok ? parsed.value : null;
    if (!parsed.ok && raw.trim() !== "" && NUMERIC_WARN_ROLES.has(role)) {
      warnings.push(coercionWarning(role, raw.trim(), parsed.reason));
    }

    switch (role) {
      case "name":
        input.name = String(value ?? raw ?? "").trim();
        break;
      case "latitude": {
        const n =
          typeof value === "number" ? value : parseFloat(String(value ?? ""));
        if (!isNaN(n)) input.latitude = n;
        break;
      }
      case "longitude": {
        const n =
          typeof value === "number" ? value : parseFloat(String(value ?? ""));
        if (!isNaN(n)) input.longitude = n;
        break;
      }
      case "altNames":
        input.altNames = Array.isArray(value) ? (value as string[]) : [];
        break;
      case "notes":
        input.notes = value != null && value !== "" ? String(value) : null;
        break;
      // The seven grade roles are FIELD VALUES now, under their reserved keys.
      // Rounding stays per-role because the CSV cell is free text and an
      // integer field must not take 2.5 — the definition's bounds catch it
      // server-side, but a silently truncated import is a worse error message.
      case "numAbseils":
        values["num_abseils"] =
          value != null && !isNaN(Number(value))
            ? Math.round(Number(value))
            : null;
        break;
      case "longestAbseil":
        values["longest_abseil"] =
          value != null && !isNaN(Number(value)) ? Number(value) : null;
        break;
      case "hours":
        values["hours"] =
          value != null && !isNaN(Number(value)) ? Number(value) : null;
        break;
      case "vGrade":
        values["v_grade"] =
          value != null && !isNaN(Number(value))
            ? Math.round(Number(value))
            : null;
        break;
      case "aGrade":
        values["a_grade"] =
          value != null && !isNaN(Number(value))
            ? Math.round(Number(value))
            : null;
        break;
      case "commitment":
        values["commitment"] =
          value != null && !isNaN(Number(value))
            ? Math.round(Number(value))
            : null;
        break;
      case "quality":
        values["quality"] =
          value != null && !isNaN(Number(value)) ? Number(value) : null;
        break;
      case "sources":
        values[SOURCES_FIELD_KEY] =
          Array.isArray(value) && value.length > 0 ? value : null;
        break;
      default:
        // attr:* / new-attr — an ordinary field value. An `attr:<key>` column
        // carries its storage key in the role (the exporter's convention); a
        // brand-new attribute has no key yet, so the CSV header is the key.
        if (typeof role === "string" && role.startsWith("attr:")) {
          values[role.slice(5)] = value ?? null;
        } else if (role === "new-attr") {
          values[header] = value ?? null;
        }
        break;
    }
  }

  // Nulls are dropped rather than stored: a stored null renders as an empty
  // field and satisfies a "has a value" filter.
  const cleaned = setFieldValues({}, values);
  if (Object.keys(cleaned).length > 0) input.fieldValues = cleaned;
  return { input, warnings };
}

export function preparePlaceRows(
  rows: Record<string, string>[],
  placeAssignments: Record<string, PlaceFieldRole>,
): {
  rows: PreparedPlaceRow[];
  warnings: string[];
  droppedRows: number;
} {
  // Raw source value for a row dropped on a missing/unreadable required field
  // — resolved once outside the loop since assignments don't vary per row.
  const latHeader = Object.entries(placeAssignments).find(
    ([, role]) => role === "latitude",
  )?.[0];
  const lonHeader = Object.entries(placeAssignments).find(
    ([, role]) => role === "longitude",
  )?.[0];
  const out: PreparedPlaceRow[] = [];
  const warnings: string[] = [];
  let droppedRows = 0;
  rows.forEach((row, rowIndex) => {
    const { input, warnings: rowWarnings } = buildPlaceInput(
      row,
      placeAssignments,
    );
    // CSV line number: header is line 1, so the first data row is line 2.
    const line = rowIndex + 2;
    const dropReason = describeDroppedPlaceRow({
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      rawLatitude: (latHeader ? row[latHeader] : "") ?? "",
      rawLongitude: (lonHeader ? row[lonHeader] : "") ?? "",
    });
    if (dropReason) {
      droppedRows += 1;
      warnings.push(`Row ${line}: ${dropReason} — skipped`);
      return;
    }
    for (const warning of rowWarnings) warnings.push(`Row ${line}: ${warning}`);
    out.push({ rowIndex, sourceName: input.name, input });
  });
  return { rows: out, warnings, droppedRows };
}

// The notes cell, then each "append to notes" column as a "Header: value" line
// (a Party column has no field of its own, but must not be lost).
function joinNotes(
  row: Record<string, string>,
  notesCol: string | undefined,
  appendCols: string[],
): string | null {
  const parts = [notesCol ? (row[notesCol] ?? "") : ""];
  for (const h of appendCols) {
    const v = (row[h] ?? "").trim();
    if (v) parts.push(`${h}: ${v}`);
  }
  return parts.filter(Boolean).join("\n") || null;
}

export function prepareTripRows(args: {
  headers: string[];
  rows: Record<string, string>[];
  tripAssignments: Record<string, ColumnRole>;
  tripNewCfForms: Record<
    string,
    { label: string; type: TripLogCustomFieldType }
  >;
  customFieldDefs: TripLogCustomFieldDef[];
  dateFormat: DateFormat;
}): {
  rows: PreparedTripRow[];
  warnings: string[];
  droppedRows: number;
} {
  const {
    headers,
    rows,
    tripAssignments,
    tripNewCfForms,
    customFieldDefs,
    dateFormat,
  } = args;
  const nameCol = headers.find((h) => tripAssignments[h] === "name");
  const dateCol = headers.find((h) => tripAssignments[h] === "date");
  const notesCol = headers.find((h) => tripAssignments[h] === "notes");
  const typeCol = headers.find((h) => tripAssignments[h] === "type");
  const appendCols = headers.filter(
    (h) => tripAssignments[h] === "appendNotes",
  );
  if (!nameCol || !dateCol) return { rows: [], warnings: [], droppedRows: 0 };

  // Custom-field columns: existing cf:<key> plus any new fields the user named.
  const cfCols: {
    header: string;
    key: string;
    type: TripLogCustomFieldType;
    label: string;
  }[] = [];
  for (const h of headers) {
    const role = tripAssignments[h];
    if (typeof role === "string" && role.startsWith("cf:")) {
      const def = customFieldDefs.find((d) => d.key === role.slice(3));
      if (def)
        cfCols.push({
          header: h,
          key: def.key,
          type: def.type,
          label: def.label,
        });
    } else if (role === "new-cf") {
      const form = tripNewCfForms[h];
      if (form?.label.trim()) {
        cfCols.push({
          header: h,
          key: makeCustomFieldKey(form.label),
          type: form.type,
          label: form.label.trim(),
        });
      }
    }
  }

  const out: PreparedTripRow[] = [];
  // Per-row/per-field coercion notices: a non-empty cell that can't parse into
  // its numeric field is left unset and reported (mirrors the place path's
  // numeric coercion warnings) — a lenient coerce would silently store "5.5"
  // as 5 or "abc" as null.
  const warnings: string[] = [];
  let droppedRows = 0;
  rows.forEach((row, rowIndex) => {
    const sourcePlaceName = (row[nameCol] ?? "").trim();
    const rawDate = row[dateCol] ?? "";
    const isoDate = toIsoDate(rawDate, dateFormat);
    if (!isoDate) {
      droppedRows += 1;
      warnings.push(
        `Row ${rowIndex + 2}: ${describeDroppedTripRow(null, rawDate)} — skipped`,
      );
      return;
    }
    const customFields: Record<string, unknown> = {};
    for (const cf of cfCols) {
      const rawCell = row[cf.header] ?? "";
      const coerced = coerceFieldValueStrict(rawCell, cf.type);
      if (coerced.ok) {
        customFields[cf.key] = coerced.value;
      } else {
        const typeWord = cf.type === "integer" ? "whole number" : "number";
        warnings.push(
          `Row ${rowIndex + 2}: ${cf.label} "${rawCell.trim()}" isn't a valid ${typeWord} — left empty`,
        );
      }
    }
    out.push({
      rowIndex,
      sourcePlaceName,
      date: isoDate,
      notes: joinNotes(row, notesCol, appendCols),
      types: typeCol ? splitTripTypes(row[typeCol] ?? "") : [],
      customFields,
    });
  });
  return { rows: out, warnings, droppedRows };
}

export const NO_PLACE_ROWS_ERROR =
  "No valid place rows found (each needs a name, latitude and longitude).";
export const NO_TRIP_ROWS_ERROR =
  "No valid trip rows found — each row needs a place name and a date we could read. " +
  "If your dates look right, check the “Date format” selector on the previous step matches your file (ISO 8601 like 2023-06-15, or day-first like 15/06/2023).";

// The first ten non-empty cells of the date column: what detectDateFormat reads.
export function dateSamples(
  rows: Record<string, string>[],
  dateCol: string | undefined,
): string[] {
  if (!dateCol) return [];
  return rows
    .map((r) => r[dateCol] ?? "")
    .filter(Boolean)
    .slice(0, 10);
}

// A place file: auto merges, no match creates, anything between is reviewed.
export function placeRowDecision(
  result: MatchResult,
): "merge" | "create" | "review" {
  if (result.confidence === "auto" && result.best) return "merge";
  return result.confidence === "none" ? "create" : "review";
}

// A logbook: auto links, the rest is reviewed.
export function tripRowDecision(result: MatchResult): "link" | "review" {
  return result.confidence === "auto" && result.best ? "link" : "review";
}
