import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UUID_V4_REGEX, systemRowIds } from "@logjam/shared";
import { seedId, cid, SEED_ID_PREFIXES } from "../../prisma/seedIds";

// The dev seed used to hand-mint version-nibble-0 ids
// ("10000000-0000-0000-0000-000000000001"), which mobile's sync push rejects
// at the envelope with 400 "id must be a UUIDv4" (parsePushOp,
// src/routes/sync.ts) — so NO seeded place could sync ANY edit from the
// phone, silently, because the local mirror still updated and the UI looked
// right. The rule was a comment until this test.
describe("hand-minted seed ids", () => {
  it("seedId mints real UUIDv4s across every prefix and index", () => {
    for (const prefix of SEED_ID_PREFIXES) {
      for (const n of [1, 5, 28, 999, 999999999999]) {
        expect(seedId(prefix, n)).toMatch(UUID_V4_REGEX);
      }
    }
    expect(cid(1)).toMatch(UUID_V4_REGEX);
  });

  // _actors.ts restates the seed's ids as literals for the integration suite;
  // a drift there is the same bug wearing a different hat.
  it("_actors.ts holds only UUIDv4 literals", () => {
    const source = readFileSync(join(__dirname, "../__tests__/_actors.ts"), "utf8");
    const literals =
      source.match(/"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"/gi) ?? [];
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) {
      expect(literal.slice(1, -1)).toMatch(UUID_V4_REGEX);
    }
  });

  // The seed itself must not reintroduce a raw literal that bypasses seedId.
  it("seed.ts hand-mints ids only through seedId", () => {
    const source = readFileSync(join(__dirname, "../../prisma/seed.ts"), "utf8");
    const literals =
      source.match(/"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"/gi) ?? [];
    expect(literals).toEqual([]);
  });

  // Two lists that must agree (root CLAUDE.md): the prefixes seed.ts actually
  // mints under, and the SEED_ID_PREFIXES the test above iterates. A new
  // prefix used in the seed but never added to the declaration would go
  // unchecked for UUIDv4 shape — which is the whole failure this file exists
  // to prevent.
  it("every prefix seed.ts mints under is declared", () => {
    const source = readFileSync(join(__dirname, "../../prisma/seed.ts"), "utf8");
    const used = new Set(
      [...source.matchAll(/\bseedId\("([0-9a-f])"/gi)].map((m) => m[1]),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const prefix of used) {
      expect(SEED_ID_PREFIXES).toContain(prefix);
    }
  });

  // The SYSTEM rows — place types and their field definitions — are pinned in
  // shared/src/placeTypes.ts because the forward MIGRATION mints them too, so
  // they are a second id space the seed knows nothing about.
  //
  // The two spaces overlapped for real: system place types and the seed's
  // user-created place types were both on prefix "9", so `seedId("9", 1)` came
  // out byte-identical to the Canyon type. That is a unique-constraint
  // violation on a good day and a user-owned row shadowing a system one on a
  // bad one — a type every user shares, silently owned by whoever seeded last.
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
