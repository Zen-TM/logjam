import type { CanyonFieldRole } from "./canyonColumns";
import type { MismatchKind } from "./canyonValueParsers";
import { parseByRole } from "./canyonValueParsers";

export type { MismatchKind };

export type SampleBadRow = { rowIndex: number; raw: string };

export type ColumnMismatch = {
  csvHeader: string;
  role: CanyonFieldRole;
  kind: MismatchKind;
  sampleBadRows: SampleBadRow[];
  totalRows: number;
  badRowCount: number;
};

// Roles that don't need type-checking (free strings)
const UNTYPED_ROLES = new Set<CanyonFieldRole>(["name", "notes", "discard", "new-attr"]);

function isAttrRole(role: CanyonFieldRole): boolean {
  return typeof role === "string" && role.startsWith("attr:");
}

function dominantKind(kinds: MismatchKind[]): MismatchKind {
  const counts: Partial<Record<MismatchKind, number>> = {};
  for (const k of kinds) counts[k] = (counts[k] ?? 0) + 1;
  let best: MismatchKind = kinds[0];
  let max = 0;
  for (const [k, c] of Object.entries(counts) as [MismatchKind, number][]) {
    if (c > max) { max = c; best = k; }
  }
  return best;
}

export function detectMismatches(
  rows: Record<string, string>[],
  assignments: Record<string, CanyonFieldRole>,
): ColumnMismatch[] {
  const mismatches: ColumnMismatch[] = [];

  for (const [header, role] of Object.entries(assignments)) {
    if (role === "discard" || UNTYPED_ROLES.has(role) || isAttrRole(role)) continue;

    const nonEmptyRows = rows.filter((r) => (r[header] ?? "").trim() !== "");
    const totalRows = nonEmptyRows.length;
    if (totalRows === 0) continue;

    const failKinds: MismatchKind[] = [];
    const badRows: SampleBadRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i][header] ?? "";
      if (!raw.trim()) continue;
      const result = parseByRole(raw, role);
      if (!result.ok) {
        failKinds.push(result.reason);
        if (badRows.length < 5) {
          badRows.push({ rowIndex: i, raw });
        }
      }
    }

    if (failKinds.length === 0) continue;

    // If bad rows are a mix of kinds, report as mixedTypes
    const uniqueKinds = new Set(failKinds);
    const kind: MismatchKind =
      uniqueKinds.size > 1 ? "mixedTypes" : dominantKind(failKinds);

    // Informational: flag columns that are mostly empty
    const emptyCount = rows.length - totalRows;
    if (emptyCount / rows.length > 0.8 && failKinds.length === 0) {
      mismatches.push({
        csvHeader: header,
        role,
        kind: "emptyDominant",
        sampleBadRows: [],
        totalRows: rows.length,
        badRowCount: 0,
      });
      continue;
    }

    mismatches.push({
      csvHeader: header,
      role,
      kind,
      sampleBadRows: badRows,
      totalRows,
      badRowCount: failKinds.length,
    });
  }

  return mismatches;
}
