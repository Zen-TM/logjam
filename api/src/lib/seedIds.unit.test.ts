import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UUID_V4_REGEX } from "@logjam/shared";
import { seedId, cid } from "../../prisma/seedIds";

// The dev seed used to hand-mint version-nibble-0 ids
// ("10000000-0000-0000-0000-000000000001"), which mobile's sync push rejects
// at the envelope with 400 "id must be a UUIDv4" (parsePushOp,
// src/routes/sync.ts) — so NO seeded canyon could sync ANY edit from the
// phone, silently, because the local mirror still updated and the UI looked
// right. The rule was a comment until this test.
describe("hand-minted seed ids", () => {
  it("seedId mints real UUIDv4s across every prefix and index", () => {
    for (const prefix of ["0", "1", "2", "3", "4", "5"]) {
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
});
