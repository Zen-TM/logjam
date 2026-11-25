import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// api/AGENTS.md: a migration that moves data replaces the checks in
// prisma/upgrade-check/. Those checks switch themselves off once the base
// has the migration they describe, so a data-moving migration that lands
// without replacing them leaves the CI `migration-upgrade` job proving only
// that migrations apply and the schema has no drift. This holds the rule: the
// newest migration with a top-level UPDATE, INSERT or DELETE is named in
// baseline.sql or verify.sql.
//
// Mutation that turns it red: add a migration directory newer than the last
// with `UPDATE users SET username = username;` in its migration.sql and name
// it in neither check file.
const MIGRATIONS = join(__dirname, "../../prisma/migrations");
const CHECKS = join(__dirname, "../../prisma/upgrade-check");

// A migration's statements outside comments and `$$` bodies (a trigger or
// function body is code the migration defines, not data it moves).
const topLevelSql = (sql: string) =>
  sql
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

const movesData = (sql: string) =>
  /^\s*(UPDATE\s+\S|INSERT\s+INTO\b|DELETE\s+FROM\b)/im.test(topLevelSql(sql));

describe("upgrade-check names the newest data-moving migration", () => {
  const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const dataMoving = dirs.filter((dir) =>
    movesData(readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8")),
  );

  it("finds the data-moving migrations it is meant to", () => {
    expect(dirs.length).toBeGreaterThan(50);
    expect(dataMoving.length).toBeGreaterThanOrEqual(8);
    expect(movesData("UPDATE users SET a = 1;")).toBe(true);
    expect(
      movesData("CREATE FUNCTION f() AS $$\n  INSERT INTO t VALUES (1);\n$$;"),
    ).toBe(false);
    expect(
      movesData("-- UPDATE users SET a = 1;\nALTER TABLE t ADD c INT;"),
    ).toBe(false);
  });

  it("baseline.sql or verify.sql names it", () => {
    const newest = dataMoving[dataMoving.length - 1];
    const checks = ["baseline.sql", "verify.sql"]
      .map((f) => readFileSync(join(CHECKS, f), "utf8"))
      .join("\n");
    expect(
      checks,
      `migration ${newest} moves data but api/prisma/upgrade-check/baseline.sql and verify.sql do not name it: replace their release-specific checks with ones for this migration (see the header of baseline.sql)`,
    ).toContain(newest);
  });
});
