// Completeness guard for the account-delete purge in routes/users.ts.
//
// Every model that holds user data through a relation to `User` must either be
// deleted by name in that purge or be listed below as removed only by the
// schema's ON DELETE CASCADE. The failure mode is silence: a new table with a
// `User` relation is wiped by the cascade, but nobody decided that, and its
// recipients' or S3 side is forgotten. This does not cover the S3 prefixes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) =>
  readFileSync(join(import.meta.dirname, "..", "..", ...p), "utf8");
const schema = read("prisma", "schema.prisma");
const purgeSource = read("src", "routes", "users.ts");

// Rows with no data of their own beyond the link to the account, which the
// cascade removes; the purge deliberately has no line for them.
const REMOVED_BY_CASCADE = ["Share", "FileSendRecipient"];

/** model name -> its `User` relation lines (the ones that name the owner). */
function modelsRelatedToUser(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of schema.matchAll(/^model (\w+) \{$([\s\S]*?)^\}$/gm)) {
    const [, name, body] = m;
    if (name === "User") continue;
    const relations = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\w+\s+User\s+@relation\(/.test(l));
    if (relations.length > 0) out.set(name, relations);
  }
  return out;
}

/** Models the purge deletes by name: `prisma.<delegate>.deleteMany/delete`. */
function explicitlyPurged(): Set<string> {
  const purge = purgeSource.slice(
    purgeSource.indexOf("accountDeleteTombstones("),
  );
  const names = new Set<string>();
  for (const m of purge.matchAll(/prisma\.(\w+)\.delete(?:Many)?\(/g)) {
    names.add(m[1][0].toUpperCase() + m[1].slice(1));
  }
  return names;
}

describe("account-delete purge covers every model related to User", () => {
  it("finds the models at all — a parser break must not make this vacuous", () => {
    const related = modelsRelatedToUser();
    expect(related.size).toBeGreaterThan(10);
    expect(related.has("Place")).toBe(true);
    expect(explicitlyPurged().has("Place")).toBe(true);
  });

  // Mutation that turns this red: adding a model with a `User` relation (or
  // deleting a deleteMany line from the purge) without naming it in
  // REMOVED_BY_CASCADE.
  it("deletes each one explicitly or names it as removed by the cascade", () => {
    const purged = explicitlyPurged();
    const uncovered = [...modelsRelatedToUser().keys()].filter(
      (model) => !purged.has(model) && !REMOVED_BY_CASCADE.includes(model),
    );
    expect(
      uncovered,
      "add a delete to the purge in routes/users.ts (and an S3 leg if it " +
        "holds objects), or list the model in REMOVED_BY_CASCADE",
    ).toEqual([]);
  });

  it("only lists a model as cascade-removed when every User relation cascades", () => {
    const related = modelsRelatedToUser();
    for (const model of REMOVED_BY_CASCADE) {
      const relations = related.get(model);
      expect(relations, `${model} has no User relation`).toBeDefined();
      for (const line of relations!) {
        expect(line, `${model}: ${line}`).toContain("onDelete: Cascade");
      }
      expect(explicitlyPurged().has(model)).toBe(false);
    }
  });
});
