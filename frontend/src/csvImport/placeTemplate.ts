import { SYSTEM_PLACE_TYPE_IDS, type TripLogCustomFieldDef } from "@logjam/shared";

// The import template for ONE place type, generated from that type's own field
// definitions.
//
// It used to be a static file (`public/templates/canyon-import-template.csv`)
// with the seven canyon grades hardcoded in its header. That file is a promise
// about what a place has, and it stopped being true the moment a place could be
// a campsite: a user importing campsites downloaded a template asking for a
// V grade and offering no column for capacity.
//
// Generated per type, the promise holds by construction — the header IS the
// form. The logbook template stays a static file, because a trip's columns do
// not depend on a place type.
//
// The header names must be what the column matcher recognises: structural
// columns by their fixed aliases, type-specific ones by their field LABEL,
// which is exactly what `detectColumns`/`assignableRolesForType` match on.

/** Structural columns every place has, in the order a person fills them in. */
const STRUCTURAL_HEADERS = ["name", "latitude", "longitude", "altNames", "notes"];

/**
 * One example row, so the file opens in a spreadsheet as something to edit
 * rather than a bare header. Values are SYNTHETIC — never a real place (the
 * committed-fixture privacy rule applies to shipped sample data too).
 */
function exampleValue(def: TripLogCustomFieldDef): string {
  if (def.type === "integer" || def.type === "float") {
    // Inside the definition's own bounds where it has them, so the example row
    // imports cleanly instead of being rejected by the field it demonstrates.
    const min = def.min ?? 1;
    const max = def.max ?? min + 2;
    const middle = Math.round((min + max) / 2);
    return def.type === "integer" ? String(middle) : middle.toFixed(1);
  }
  if (def.type === "boolean") return "false";
  if (def.type === "date") return "2026-01-31";
  return "";
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function placeImportTemplateCsv(
  typeName: string,
  typeId: string,
  defs: TripLogCustomFieldDef[],
): string {
  const isCanyon = typeId === SYSTEM_PLACE_TYPE_IDS.canyon;
  const headers = [...STRUCTURAL_HEADERS, ...defs.map((def) => def.label)];
  const example = [
    `Example ${typeName}`,
    "-33.700000",
    "150.300000",
    "Alt Name 1; Alt Name 2",
    // The notes cell carries the comma the quoting rule exists for.
    `Sample notes about the ${typeName.toLowerCase()}`,
    ...defs.map(exampleValue),
  ];
  // The canyon template shipped with grade examples filled in, and losing them
  // would make the generated file worse than the static one it replaces for
  // the type most people import.
  if (isCanyon) {
    for (const [index, def] of defs.entries()) {
      const filled: Record<string, string> = {
        v_grade: "4",
        a_grade: "3",
        commitment: "3",
        quality: "4",
        num_abseils: "6",
        longest_abseil: "40",
        hours: "6",
      };
      const value = filled[def.key];
      if (value) example[STRUCTURAL_HEADERS.length + index] = value;
    }
  }
  return `${headers.map(csvCell).join(",")}\n${example.map(csvCell).join(",")}\n`;
}

/** `Campsite import template.csv` — named after the type, because a user with
 *  three of these in their downloads folder needs to tell them apart. */
export function placeImportTemplateFilename(typeName: string): string {
  return `${typeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-import-template.csv`;
}
