import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOTIFICATION_TYPES } from "@logjam/shared";

// Two lists that must agree (root AGENTS.md): what the schema holds and what
// the dev seed writes. dev, the integration suite, the `migration-upgrade` job
// and Logjam Web's e2e all start from the seed, so a table it leaves empty is
// one none of them ever sees a row of.
//
// Mutations that turn this red: adding a model to schema.prisma that the seed
// neither writes nor lists in NOT_SEEDED; deleting the seed's write of a model;
// listing a model in NOT_SEEDED that the seed does write; adding a type to
// NOTIFICATION_TYPES the seed has no row of, or a seed row of a type outside it.

const read = (...p: string[]) =>
  readFileSync(join(__dirname, "../..", ...p), "utf8");
const SEED = read("prisma", "seed.ts");

const modelNames = [
  ...read("prisma", "schema.prisma").matchAll(/^model (\w+) \{/gm),
].map((m) => m[1]);
const delegate = (model: string) => model[0].toLowerCase() + model.slice(1);

/** Delegates the seed writes: `prisma.<model>.create` / `.createMany` / `.upsert`. */
const written = new Set(
  [...SEED.matchAll(/\bprisma\.(\w+)\.(?:create|createMany|upsert)\b/g)].map(
    (m) => m[1],
  ),
);

/** Written inside another model's `create`, so no `prisma.<model>.create` names it. */
const WRITTEN_NESTED: Record<string, RegExp> = {
  TripLogPlace: /places:\s*\{\s*create\b/,
};

/** Deliberately empty, with the reason. */
const NOT_SEEDED: Record<string, string> = {
  EgressLogCursor:
    "written by the egress sweeper as it reads S3 access logs, which MiniStack does not deliver; the seed only clears it",
};

describe("the dev seed covers every table", () => {
  it("finds the models at all — a parser break must not make this vacuous", () => {
    expect(modelNames.length).toBeGreaterThan(20);
    expect(modelNames).toContain("TopoJob");
    expect(written.has("topoJob")).toBe(true);
  });

  it("writes every model or lists it as deliberately empty", () => {
    const missing = modelNames.filter(
      (model) =>
        !written.has(delegate(model)) &&
        !(WRITTEN_NESTED[model] && WRITTEN_NESTED[model].test(SEED)) &&
        !(model in NOT_SEEDED),
    );
    expect(
      missing,
      "seed a row of it in prisma/seed.ts, or list it in NOT_SEEDED with the reason",
    ).toEqual([]);
  });

  it("lists nothing that is seeded, or that is not a model", () => {
    const stale = [
      ...Object.keys(NOT_SEEDED),
      ...Object.keys(WRITTEN_NESTED),
    ].filter(
      (model) =>
        !modelNames.includes(model) ||
        (model in NOT_SEEDED && written.has(delegate(model))),
    );
    expect(stale).toEqual([]);
  });
});

describe("the dev seed has a notification of every type", () => {
  const seededTypes = new Set(
    [...SEED.matchAll(/\btype: "([a-z_]+)",\s*\n\s*payload:/g)].map(
      (m) => m[1],
    ),
  );

  it("finds the rows at all", () => {
    expect(seededTypes.size).toBeGreaterThan(5);
  });

  it("writes one row of each declared type", () => {
    expect(NOTIFICATION_TYPES.filter((t) => !seededTypes.has(t))).toEqual([]);
  });

  it("writes no type the declaration lacks", () => {
    const declared: readonly string[] = NOTIFICATION_TYPES;
    expect([...seededTypes].filter((t) => !declared.includes(t))).toEqual([]);
  });
});
