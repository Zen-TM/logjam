import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SYNC_ENTITY_TYPES, UUID_V4_REGEX, systemRowIds } from "@logjam/shared";
import * as seedIdsModule from "../../prisma/seedIds";
import { seedId, cid, SEED_ID_PREFIXES } from "../../prisma/seedIds";

// Mobile sync push rejects non-UUIDv4 ids at the envelope with 400 "id must
// be a UUIDv4" (parsePushOp, src/routes/sync.ts), so seeded rows must be valid
// UUIDv4s for edits from Logjam GPS to sync.
describe("hand-minted seed ids", () => {
  it("seedId mints real UUIDv4s across every prefix and index", () => {
    for (const prefix of SEED_ID_PREFIXES) {
      for (const n of [1, 5, 28, 999, 999999999999]) {
        expect(seedId(prefix, n)).toMatch(UUID_V4_REGEX);
      }
    }
    expect(cid(1)).toMatch(UUID_V4_REGEX);
  });

  // The ids tests name (src/__tests__/_actors.ts) are declared once in
  // seedIds.ts and the seed writes its rows under those same constants, so the
  // two cannot disagree. A literal in _actors.ts, or a seed that re-mints one
  // of these ids by hand, brings the drift back.
  // Mutation that turns it red: in seed.ts replace `id: PLAN_PLACE_ID` with
  // `id: wpid(100)`, or paste a UUID literal into _actors.ts.
  it("the ids tests name are the seed's own constants", () => {
    const actors = readFileSync(
      join(__dirname, "../__tests__/_actors.ts"),
      "utf8",
    );
    const literals =
      actors.match(/"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"/gi) ?? [];
    expect(
      literals.filter((l) => l !== '"99999999-9999-4999-8999-999999999999"'),
      "_actors.ts holds a seed id literal: export it from prisma/seedIds.ts instead",
    ).toEqual([]);

    // Without its import line, which names every id whether it is used or not.
    const seed = readFileSync(
      join(__dirname, "../../prisma/seed.ts"),
      "utf8",
    ).replace(/import \{[^}]*\} from "\.\/seedIds";/, "");
    const named = Object.keys(seedIdsModule).filter((k) => /_ID$/.test(k));
    expect(named.length).toBeGreaterThanOrEqual(12);
    for (const name of named) {
      expect(
        actors,
        `${name} is declared in prisma/seedIds.ts but _actors.ts does not export it`,
      ).toMatch(new RegExp(`\\b${name}\\b`));
      expect(
        seed,
        `${name} is declared in prisma/seedIds.ts but prisma/seed.ts never uses it: the seed writes that row under another id`,
      ).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  // The seed itself must not reintroduce a raw literal that bypasses seedId.
  it("seed.ts hand-mints ids only through seedId", () => {
    const source = readFileSync(
      join(__dirname, "../../prisma/seed.ts"),
      "utf8",
    );
    const literals =
      source.match(/"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"/gi) ?? [];
    expect(literals).toEqual([]);
  });

  // Two lists that must agree (root AGENTS.md): the prefixes seed.ts actually
  // mints under, and the SEED_ID_PREFIXES the test above iterates. A new
  // prefix used in the seed but never added to the declaration would go
  // unchecked for UUIDv4 shape — which is the whole failure this file exists
  // to prevent.
  it("every prefix seed.ts mints under is declared", () => {
    const source = readFileSync(
      join(__dirname, "../../prisma/seed.ts"),
      "utf8",
    );
    const used = new Set(
      [...source.matchAll(/\bseedId\("([0-9a-f])"/gi)].map((m) => m[1]),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const prefix of used) {
      expect(SEED_ID_PREFIXES).toContain(prefix);
    }
  });

  // A synced row the seed creates without an id gets a random one, and a
  // re-seed deletes rows without tombstones: a paired phone keeps every past
  // seed's copies on top of the new ones (trips reached 381 against 127). So
  // every ROW of a SYNC_ENTITY_TYPES model carries an id: each element of a
  // literal `data: [...]`, the literal `data: {...}`, or, for a row built by a
  // function or a `.map`, the builder (one shape, so one check).
  // Mutation that turns it red: delete the `id:` line of any one row in a
  // `createMany` of a synced model in seed.ts (placeLink, route, media).
  it("every seeded row of a synced entity is created with a pinned id", () => {
    const source = readFileSync(
      join(__dirname, "../../prisma/seed.ts"),
      "utf8",
    );
    // Index of the bracket closing the one at `open`, skipping strings,
    // template literals and comments.
    const close = (open: number): number => {
      let depth = 0;
      for (let i = open; i < source.length; i++) {
        const c = source[i];
        if (c === "/" && source[i + 1] === "/") {
          i = source.indexOf("\n", i);
        } else if (c === '"' || c === "'" || c === "`") {
          for (i++; source[i] !== c; i++) if (source[i] === "\\") i++;
        } else if ("([{".includes(c)) depth++;
        else if (")]}".includes(c) && --depth === 0) return i;
      }
      throw new Error(`unbalanced bracket at ${open}`);
    };
    // The depth-1 elements of the array or object literal opening at `open`,
    // as [start, end] offsets.
    const elements = (open: number) => {
      const end = close(open);
      const out: [number, number][] = [];
      let from = open + 1;
      for (let i = open + 1; i < end; i++) {
        const c = source[i];
        if ("([{".includes(c)) i = close(i);
        else if (c === '"' || c === "'" || c === "`") {
          for (i++; source[i] !== c; i++) if (source[i] === "\\") i++;
        } else if (c === "/" && source[i + 1] === "/") {
          i = source.indexOf("\n", i);
        } else if (c === ",") {
          out.push([from, i]);
          from = i + 1;
        }
      }
      out.push([from, end]);
      return out.filter(([a, z]) => source.slice(a, z).trim() !== "");
    };
    // Does the object literal opening at `open` have a top-level `id:` key?
    const hasId = (open: number) =>
      elements(open).some(([a, z]) =>
        /^(?:\s|\/\/[^\n]*\n)*id:/.test(source.slice(a, z)),
      );
    // A top-level `function name(…) {…}`: from its signature to the closing
    // brace at column 0.
    const builderBody = (name: string) => {
      const at = source.search(new RegExp(`\\nfunction ${name}\\(`));
      return at < 0 ? "" : source.slice(at, source.indexOf("\n}\n", at));
    };
    const line = (at: number) => source.slice(0, at).split("\n").length;

    const calls = [
      ...source.matchAll(/prisma\.(\w+)\.(create|createMany)\(/g),
    ].filter((m) => (SYNC_ENTITY_TYPES as readonly string[]).includes(m[1]));
    expect(calls.length).toBeGreaterThanOrEqual(10);
    let rows = 0;
    const withoutId: string[] = [];
    for (const m of calls) {
      const call = m.index! + m[0].length - 1;
      const data = /\bdata:\s*/.exec(source.slice(call, close(call)));
      if (!data)
        throw new Error(`no data: in ${m[0]} at seed.ts:${line(call)}`);
      const value = call + data.index + data[0].length;
      const bad = (at: number, what: string) =>
        withoutId.push(`prisma.${m[1]}.${m[2]} ${what} at seed.ts:${line(at)}`);
      if (source[value] === "[") {
        for (const [a] of elements(value)) {
          const open = source.indexOf("{", a);
          rows++;
          if (!hasId(open)) bad(open, "row");
        }
      } else if (source[value] === "{") {
        rows++;
        if (!hasId(value)) bad(value, "row");
      } else {
        const builder = /^(\w+)\(/.exec(source.slice(value))?.[1];
        rows++;
        const shape = builder
          ? builderBody(builder)
          : source.slice(value, close(call));
        if (!/\bid:/.test(shape)) bad(value, "builder");
      }
    }
    expect(rows).toBeGreaterThanOrEqual(30);
    expect(
      withoutId,
      "synced rows created without an id: mint one with seedId under a declared prefix",
    ).toEqual([]);
  });

  // The SYSTEM rows — place types and their field definitions — are pinned in
  // shared/src/placeTypes.ts because the forward MIGRATION mints them too, so
  // they are a second id space the seed knows nothing about.
  //
  // An overlap between system place types and the seed's user-created
  // place types would cause a unique-constraint violation or a user-owned row
  // shadowing a system type that every user shares.
  it("system row ids are real UUIDv4s", () => {
    for (const id of systemRowIds()) {
      expect(id).toMatch(UUID_V4_REGEX);
    }
  });

  it("the seed's id space cannot collide with the system one", () => {
    const systemPrefixes = new Set(systemRowIds().map((id) => id[0]));
    for (const prefix of systemPrefixes) {
      expect(
        SEED_ID_PREFIXES,
        `prefix "${prefix}" is used by BOTH the system rows and the dev seed`,
      ).not.toContain(prefix);
    }
  });

  // Belt and braces over the same property, in case a future system id is
  // minted some other way: no seeded id, at any index the seed plausibly
  // reaches, may equal a system id.
  it("no seeded id equals a system id", () => {
    const system = new Set(systemRowIds());
    for (const prefix of SEED_ID_PREFIXES) {
      for (let n = 1; n <= 64; n++) {
        expect(system.has(seedId(prefix, n))).toBe(false);
      }
    }
  });
});
