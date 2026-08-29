// Formats the reason a source CSV row is dropped before import (missing
// required field, unreadable value). Pure and separate from
// UnifiedImportDialog.tsx so the drop conditions are unit-testable without
// rendering the dialog. Returns null when the row is fine to import.
// See FECO-006 / 01-decisions.md D5: every drop must be reported with the
// source row number and offending value, not silently discarded.

export function describeDroppedCanyonRow(args: {
  name: string;
  latitude: number;
  longitude: number;
  rawLatitude: string;
  rawLongitude: string;
}): string | null {
  if (!args.name) return "name is missing";
  if (isNaN(args.latitude)) return `latitude "${args.rawLatitude}" couldn't be read`;
  if (isNaN(args.longitude)) return `longitude "${args.rawLongitude}" couldn't be read`;
  return null;
}

export function describeDroppedTripRow(isoDate: string | null, rawDate: string): string | null {
  if (isoDate) return null;
  return `date "${rawDate.trim()}" couldn't be read`;
}
