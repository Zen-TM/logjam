// The completeness half of the sharee denylist (lib/placeVisibility.ts).
//
// `serializeSharedPlace` spreads the row and removes what must not travel, so
// its failure mode is silence: the next owner-private column added to `Place`
// reaches every sharee from the moment it exists until someone remembers that
// file. Nobody writes a leak — they add a column.
//
// So the schema is the ground truth here, exactly as it is in
// snapshotScrub.unit.test.ts: read the model's columns out of schema.prisma and
// fail when one is classified by neither list. That makes adding a column to
// `Place` a decision about visibility rather than a default.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  OWNER_PRIVATE_PLACE_FIELDS,
  SHAREE_VISIBLE_PLACE_FIELDS,
  serializeSharedPlace,
} from "./placeVisibility";

const schema = readFileSync(
  join(import.meta.dirname, "..", "..", "prisma", "schema.prisma"),
  "utf8",
);

/**
 * The SCALAR fields of `model Place` — the ones that reach a response.
 * Relations are excluded: they are not columns, and nothing spreads them onto
 * a place response (the includes that do carry them are separate decisions,
 * `placeListInclude` being the one with its own rule).
 */
function placeScalarFields(): string[] {
  const body = /^model Place \{$([\s\S]*?)^\}$/m.exec(schema)?.[1];
  if (!body) throw new Error("model Place not found in schema.prisma");
  const fields: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
    const match = /^(\w+)\s+(\w+)(\[\])?\??/.exec(trimmed);
    if (!match) continue;
    const [, name, type] = match;
    // A relation field's type is a MODEL name (capitalised); a scalar's is a
    // Prisma primitive. `PlaceType`/`PlaceShare`/`Route` are relations even
    // though `placeTypeId` beside them is not.
    const SCALARS = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "Bytes", "BigInt", "Decimal"]);
    if (!SCALARS.has(type)) continue;
    fields.push(name);
  }
  return fields;
}

describe("every Place column is classified for sharees", () => {
  it("finds the model at all — a rename must not make this vacuous", () => {
    const fields = placeScalarFields();
    expect(fields.length).toBeGreaterThan(10);
    expect(fields).toContain("name");
    expect(fields).toContain("foreignFields");
  });

  it("classifies each column as sharee-visible or owner-private, with a reason", () => {
    const visible = new Set(SHAREE_VISIBLE_PLACE_FIELDS);
    const unclassified = placeScalarFields().filter(
      (field) =>
        !visible.has(field) && !(field in OWNER_PRIVATE_PLACE_FIELDS),
    );
    // The message is the point: whoever added the column reads it.
    expect(
      unclassified,
      "add each of these to SHAREE_VISIBLE_PLACE_FIELDS or to " +
        "OWNER_PRIVATE_PLACE_FIELDS (with the reason) in lib/placeVisibility.ts",
    ).toEqual([]);
  });

  it("classifies nothing that is not a column any more", () => {
    // The other direction: a column removed from the schema leaves a stale
    // entry claiming to protect something, which reads as coverage it no
    // longer provides.
    const fields = new Set(placeScalarFields());
    const stale = [
      ...SHAREE_VISIBLE_PLACE_FIELDS,
      ...Object.keys(OWNER_PRIVATE_PLACE_FIELDS),
    ].filter((field) => !fields.has(field));
    expect(stale).toEqual([]);
  });

  it("names no column in both lists", () => {
    const both = SHAREE_VISIBLE_PLACE_FIELDS.filter(
      (field) => field in OWNER_PRIVATE_PLACE_FIELDS,
    );
    expect(both).toEqual([]);
  });

  it("gives every owner-private column a non-empty reason", () => {
    for (const [field, reason] of Object.entries(OWNER_PRIVATE_PLACE_FIELDS)) {
      expect(reason.length, field).toBeGreaterThan(10);
    }
  });
});

describe("serializeSharedPlace", () => {
  it("strips every owner-private column, not just the one it was written for", () => {
    const row: Record<string, unknown> = {
      id: "p1",
      name: "Claustral",
      notes: "shared with the place record",
      foreignFields: [{ key: "x", label: "X", type: "string", value: 1 }],
      importKey: "claustral|-33.5|150.4",
      importBatchId: "batch-1",
    };
    const shared = serializeSharedPlace(row);
    for (const field of Object.keys(OWNER_PRIVATE_PLACE_FIELDS)) {
      expect(shared, field).not.toHaveProperty(field);
    }
    // Absent, not null: "not yours to know" rather than "empty" — the same
    // distinction the `_count` rule makes.
    expect("foreignFields" in shared).toBe(false);
    expect(shared.name).toBe("Claustral");
    expect(shared.notes).toBe("shared with the place record");
  });

  it("passes through a column it has never heard of", () => {
    // The default is VISIBLE, deliberately: a sharee is entitled to the record.
    // The completeness guard above is what stops that default being silent.
    expect(serializeSharedPlace({ id: "p1", somethingNew: 7 }).somethingNew).toBe(7);
  });
});
