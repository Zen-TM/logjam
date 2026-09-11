import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPES,
  isPlaceTypeIconKey,
} from "@logjam/shared";

// THE MIGRATION AND THE DECLARATION ARE TWO LISTS THAT MUST AGREE.
//
// `20260906010000` inserts the system place types and field definitions as SQL
// literals; `shared/src/placeTypes.ts` declares the same rows for the seed and
// for every client. They drifted immediately and silently: the migration wrote
// `waves` and `tent` as icon keys — lucide-only names that are not in the
// curated cross-platform list at all — so a database built by migration drew a
// fallback pin for Canyon and Campsite while a seeded one drew the right icon.
// Nothing failed, because both clients fall back rather than crash.
//
// The migration's own comment claimed a test enforced this. There wasn't one.
// This is it, and it reads the SQL as ground truth rather than restating it.
const MIGRATIONS = join(__dirname, "../../prisma/migrations");

/** Every migration's SQL, concatenated in the order Prisma applies them — so a
 *  later corrective migration counts, which is how a bad literal is FIXED
 *  without editing a file that has already run somewhere. */
function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => !name.startsWith("."))
    .sort()
    .map((name) => {
      try {
        return readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

/** The value each system row ENDS UP with: the INSERT literal, unless a later
 *  migration updates that column for that id. Both the icon and the colour were
 *  wrong on the way in, and both are corrected by a later migration rather than
 *  by editing one that has already been applied. */
function finalValue(
  sql: string,
  column: "icon_key" | "color",
  id: string,
  inserted: string,
): string {
  let value = inserted;
  // Statement by statement: a regex spanning `;` happily matches one UPDATE's
  // SET against the NEXT one's WHERE, which is how this helper first reported
  // Campsite as a droplet.
  for (const statement of sql.split(";")) {
    if (!statement.includes('UPDATE "place_types"')) continue;
    if (!statement.includes(`"id" = '${id}'`)) continue;
    const set = new RegExp(`SET "${column}" = '([^']+)'`).exec(statement);
    if (set) value = set[1];
  }
  return value;
}

describe("the system rows the migration inserts", () => {
  const sql = migrationSql();

  it("gives every system place type the declared name, colour and icon", () => {
    for (const type of SYSTEM_PLACE_TYPES) {
      const row = new RegExp(
        `\\('${type.id}', NULL, '([^']+)',\\s*'([^']+)',\\s*'([^']+)',\\s*(\\d+)`,
      ).exec(sql);
      expect(row, `no INSERT for the ${type.name} place type`).toBeTruthy();
      const [, name, iconKey, color, position] = row!;
      expect(name).toBe(type.name);
      expect(finalValue(sql, "color", type.id, color).toUpperCase()).toBe(
        type.color.toUpperCase(),
      );
      expect(Number(position)).toBe(type.position);
      expect(
        finalValue(sql, "icon_key", type.id, iconKey),
        `${type.name}'s icon key in SQL`,
      ).toBe(type.iconKey);
    }
  });

  // The reason the icon key matters at all: a key outside the curated list
  // resolves in neither icon set, and both clients quietly draw a pin.
  it("only uses icon keys the curated cross-platform list contains", () => {
    for (const type of SYSTEM_PLACE_TYPES) {
      const inserted = new RegExp(
        `\\('${type.id}', NULL, '[^']+',\\s*'([^']+)'`,
      ).exec(sql)?.[1];
      expect(
        isPlaceTypeIconKey(finalValue(sql, "icon_key", type.id, inserted ?? "")),
      ).toBe(true);
    }
  });

  it("gives every system field definition the declared key, label, type and bounds", () => {
    for (const def of SYSTEM_FIELD_DEFS) {
      const row = new RegExp(
        `\\('${def.id}', NULL, 'place', '([^']+)',\\s*'([^']+)',\\s*'([^']+)',\\s*([\\w.]+),\\s*([\\w.]+),\\s*(\\d+)`,
      ).exec(sql);
      expect(row, `no INSERT for the ${def.key} definition`).toBeTruthy();
      const [, key, label, type, min, max] = row!;
      expect(key).toBe(def.key);
      expect(label).toBe(def.label);
      expect(type).toBe(def.type);
      expect(min === "NULL" ? null : Number(min)).toBe(def.min);
      expect(max === "NULL" ? null : Number(max)).toBe(def.max);
    }
  });
});
