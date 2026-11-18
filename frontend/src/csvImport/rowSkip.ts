import { t } from "@logjam/shared";

// Formats the reason a source CSV row is dropped before import (missing
// required field, unreadable value). Pure and separate from
// UnifiedImportDialog.tsx so the drop conditions are unit-testable without
// rendering the dialog. Returns null when the row is fine to import.
// Every drop must be reported with the source row number and offending value,
// not silently discarded.

/** Why a row was dropped, kept as data: `skippedRowLine` turns it into one
 *  whole message, so no clause message sits in a hole of another. */
export type DropReason =
  | { kind: "name" }
  | { kind: "latitude" | "longitude" | "date"; raw: string };

export function describeDroppedPlaceRow(args: {
  name: string;
  latitude: number;
  longitude: number;
  rawLatitude: string;
  rawLongitude: string;
}): DropReason | null {
  if (!args.name) return { kind: "name" };
  if (isNaN(args.latitude)) return { kind: "latitude", raw: args.rawLatitude };
  if (isNaN(args.longitude))
    return { kind: "longitude", raw: args.rawLongitude };
  return null;
}

export function describeDroppedTripRow(
  isoDate: string | null,
  rawDate: string,
): DropReason | null {
  if (isoDate) return null;
  return { kind: "date", raw: rawDate.trim() };
}

/** A dropped row as the result lists it: "Row 4: latitude "x" couldn't be
 *  read — skipped". */
export function skippedRowLine(line: number, reason: DropReason): string {
  switch (reason.kind) {
    case "name":
      return t`Row ${line}: name is missing — skipped`;
    case "latitude":
      return t`Row ${line}: latitude "${reason.raw}" couldn't be read — skipped`;
    case "longitude":
      return t`Row ${line}: longitude "${reason.raw}" couldn't be read — skipped`;
    case "date":
      return t`Row ${line}: date "${reason.raw}" couldn't be read — skipped`;
  }
}
