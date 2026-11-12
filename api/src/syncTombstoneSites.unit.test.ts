import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Prisma } from "@prisma/client";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SYNC_ENTITY_TYPES } from "@logjam/shared";

// A hard delete of a synced entity writes its tombstone in the same
// transaction, or phones keep the row forever (lib/syncTombstones.ts). Each
// entity type in SYNC_ENTITY_TYPES is named for its Prisma delegate, so that
// list is the one declaration of what is synced. `share` is the one delegate
// added to it: a direct share is no entity, but dropping a row hides a route
// from its recipient, who needs the same tombstone.
//
// The scan finds every `.delete(` / `.deleteMany(` on one of those delegates
// and requires a tombstone write (`writeTombstones(` or a raw
// `syncTombstone.createMany(`) in the same enclosing function. What it cannot
// see is whether the tombstone names the right rows: the integration tests in
// `__tests__` pull the delta after a delete for that.
//
// Mutation that turns it red: add a `tx.placeLink.delete(...)` to any function
// with no tombstone write, or remove the `writeTombstones` call beside an
// existing delete (lib/placeLinks.ts, routes/media.ts).

const SRC = __dirname;
const DELEGATES = new Set<string>([...SYNC_ENTITY_TYPES, "share"]);

// Deletes with no tombstone, each with the reason none is owed. Keyed by
// `file:function`. Stale entries fail the test.
const EXEMPT: Record<string, string> = {
  "lib/planItems.ts:deletePlanItem":
    "A plan's places and routes have no owner, cannot be shared and never " +
    "reach /sync/delta, so no phone holds one to forget " +
    "(__tests__/tripPlanRows.test.ts).",
  "lib/planItems.ts:memberGone":
    "Same: it deletes the places and routes a leaving member added to a plan.",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__" && name !== "__fixtures__")
        sourceFiles(path, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const isFunction = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

/** The nearest enclosing function with a name, for the exemption key. */
function nameOf(fn: ts.Node): string {
  for (let n: ts.Node | undefined = fn; n; n = n.parent) {
    if (isFunction(n) && n.name) return n.name.getText();
    if (
      ts.isVariableDeclaration(n) &&
      n.initializer &&
      isFunction(n.initializer)
    ) {
      return n.name.getText();
    }
  }
  return "(anonymous)";
}

function writesTombstone(fn: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      if (
        callee === "writeTombstones" ||
        /syncTombstone\.createMany$/.test(callee)
      )
        found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return found;
}

type Site = { where: string; key: string; tombstoned: boolean };
const sites: Site[] = [];

for (const file of sourceFiles(SRC)) {
  const rel = relative(SRC, file);
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^delete(Many)?$/.test(node.expression.name.text)
    ) {
      const receiver = node.expression.expression;
      if (
        ts.isPropertyAccessExpression(receiver) &&
        DELEGATES.has(receiver.name.text)
      ) {
        let fn: ts.Node = sf;
        for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
          if (isFunction(n)) {
            fn = n;
            break;
          }
        }
        sites.push({
          where: `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
          key: `${rel}:${nameOf(fn)}`,
          tombstoned: writesTombstone(fn),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

describe("every hard delete of a synced entity writes a tombstone", () => {
  it("names a Prisma model for every synced entity type", () => {
    const models = Object.keys(Prisma.ModelName).map(
      (m) => m[0].toLowerCase() + m.slice(1),
    );
    for (const delegate of DELEGATES) expect(models).toContain(delegate);
  });

  it("finds the delete sites it is meant to guard", () => {
    // 31 and 27 today; a walk that stops matching drops both to zero.
    expect(sites.length).toBeGreaterThanOrEqual(25);
    expect(sites.filter((s) => s.tombstoned).length).toBeGreaterThanOrEqual(22);
  });

  it("has a tombstone write in the function of each one", () => {
    const missing = sites.filter((s) => !s.tombstoned && !(s.key in EXEMPT));
    expect(
      missing.map((s) => s.where),
      "A hard delete of a synced row needs writeTombstones(tx, ...) in the " +
        "same transaction (lib/syncTombstones.ts has a builder for each " +
        "entity), for every user who could see the row. If the row never " +
        "reaches a phone, add the function to EXEMPT in " +
        "syncTombstoneSites.unit.test.ts with the reason.",
    ).toEqual([]);
  });

  it("keeps no exemption for a function that does write one, or is gone", () => {
    for (const key of Object.keys(EXEMPT)) {
      const there = sites.filter((s) => s.key === key);
      expect(
        there.length,
        `${key} no longer deletes a synced row`,
      ).toBeGreaterThan(0);
      expect(
        there.every((s) => !s.tombstoned),
        `${key} writes a tombstone: drop its exemption`,
      ).toBe(true);
    }
  });
});
