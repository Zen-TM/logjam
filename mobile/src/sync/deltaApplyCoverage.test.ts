// Every delta entity the protocol carries must actually be WRITTEN to the
// mirror, and the row tally must count it.
//
// This exists because `placeTypes` was parsed and then silently dropped: the
// `satisfies DeltaEntityKey` clause in `deltaPull.ts` pins the PARSE side, so
// the key could not go missing from the `changes` object — and nothing pinned
// the apply side, so the loop that writes it was simply absent. Every other
// entity had one. The failure was invisible because `listMirrorPlaceTypes`
// falls back to the compiled-in `SYSTEM_PLACE_TYPES` when the table is empty:
// the three built-ins rendered perfectly, and a user's own place type never
// reached the phone at all — no tab, and no way to pick it on a place form.
//
// Root CLAUDE.md, "two lists that must agree = one declaration + a test". The
// declaration is `DELTA_ENTITY_ORDER`; this derives the other list from it
// rather than restating it, so an entity added tomorrow fails here until
// someone writes its loop.
//
// Source-parsing rather than a fake database, for the same reason
// `placeVisibility.unit.test.ts` parses `schema.prisma`: what is being asserted
// is that a line EXISTS, and a mocked SQLite that never sees the missing loop
// would pass exactly as happily as the shipped bug did.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DELTA_ENTITY_ORDER } from "@logjam/shared";

const source = readFileSync(join(__dirname, "deltaPull.ts"), "utf8");

describe("delta apply coverage", () => {
  it.each(DELTA_ENTITY_ORDER)("writes %s to the mirror", (entity) => {
    expect(
      source.includes(`for (const row of changes.${entity})`),
      `deltaPull.ts parses changes.${entity} but never writes it — add the ` +
        `apply loop, or the rows arrive and vanish`,
    ).toBe(true);
  });

  it.each(DELTA_ENTITY_ORDER)("counts %s in changedRows", (entity) => {
    // An uncounted entity makes a page look empty, which stops the "did
    // anything change" callers from re-reading — the same bug one layer up.
    expect(
      source.includes(`changes.${entity}.length`),
      `deltaPull.ts does not add changes.${entity}.length to changedRows`,
    ).toBe(true);
  });
});
