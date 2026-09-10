import { describe, it, expect } from "vitest";

import {
  SYSTEM_PLACE_TYPES,
  SYSTEM_PLACE_TYPE_IDS,
  SYSTEM_FIELD_DEFS,
  CANYON_FORM_FIELD_KEYS,
  RESERVED_FIELD_KEYS,
  isReservedFieldKey,
  isInternalFieldValueKey,
  SOURCES_FIELD_KEY,
  LEGACY_ATTRIBUTES_FIELD_KEY,
  systemRowIds,
  assertSystemIdsAreUuidV4,
} from "./placeTypes.js";
import { isUuidV4 } from "./sync.js";
import { makeCustomFieldKey, isTripLogCustomFieldDef } from "./tripLogFields.js";

describe("system row ids", () => {
  // The seedIds.ts incident, in its new home. parsePushOp validates every
  // client-minted entity id with isUuidV4 and rejects the WHOLE request on a
  // mismatch, so a hand-minted id with a version nibble of 0 makes every place
  // of a system type permanently unsyncable — invisibly, because the local
  // mirror still updates and only the outbox row holds the 400.
  it("are real UUIDv4s, version and variant nibbles included", () => {
    for (const id of systemRowIds()) {
      expect(isUuidV4(id), `${id} is not a UUIDv4`).toBe(true);
    }
    expect(() => assertSystemIdsAreUuidV4()).not.toThrow();
  });

  it("are distinct", () => {
    const ids = systemRowIds();
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the three system place types", () => {
  // Exactly three, and a fourth is a product decision. An unused seeded type is
  // a tab that costs every user attention forever.
  it("are exactly Canyon, Campsite and Marker", () => {
    expect(SYSTEM_PLACE_TYPES.map((type) => type.name)).toEqual([
      "Canyon",
      "Campsite",
      "Marker",
    ]);
  });

  it("agree with the id map", () => {
    for (const type of SYSTEM_PLACE_TYPES) {
      expect(SYSTEM_PLACE_TYPE_IDS[type.key]).toBe(type.id);
    }
    expect(Object.keys(SYSTEM_PLACE_TYPE_IDS).length).toBe(SYSTEM_PLACE_TYPES.length);
  });

  // Marker carries no fields at all — it is where every existing Waypoint lands
  // in phase 1c, and a waypoint that was never about anything must not acquire
  // a form to fill in.
  it("give Marker no fields", () => {
    const scoped = SYSTEM_FIELD_DEFS.filter((def) =>
      def.placeTypes.includes("marker"),
    );
    expect(scoped).toEqual([]);
  });
});

describe("system field definitions", () => {
  it("all pass the definition validator, one-sided bounds included", () => {
    for (const def of SYSTEM_FIELD_DEFS) {
      expect(
        isTripLogCustomFieldDef({
          key: def.key,
          label: def.label,
          type: def.type,
          ...(def.min !== null ? { min: def.min } : {}),
          ...(def.max !== null ? { max: def.max } : {}),
        }),
        `${def.key} is not a valid definition`,
      ).toBe(true);
    }
  });

  // `quality` is ONE def scoped to two types, not two defs. This is the
  // per-owner-key rule applied to system defs: the key means one thing
  // wherever it appears, which is what makes copy reconciliation and
  // cross-type filtering coherent.
  it("share one `quality` between Canyon and Campsite", () => {
    const quality = SYSTEM_FIELD_DEFS.filter((def) => def.key === "quality");
    expect(quality).toHaveLength(1);
    expect(quality[0].placeTypes.sort()).toEqual(["campsite", "canyon"]);
  });

  it("have unique keys", () => {
    const keys = SYSTEM_FIELD_DEFS.map((def) => def.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("scope every def to at least one system type", () => {
    for (const def of SYSTEM_FIELD_DEFS) {
      expect(def.placeTypes.length, `${def.key} is scoped to nothing`).toBeGreaterThan(0);
      for (const key of def.placeTypes) {
        expect(SYSTEM_PLACE_TYPE_IDS[key]).toBeDefined();
      }
    }
  });
});

describe("reserved keys", () => {
  // DERIVED, not restated. A hardcoded copy is the "two lists that must agree"
  // failure the root CLAUDE.md rule names — a tenth system def would join one
  // list and not the other, and the collision would surface as a RopeWiki
  // import writing a value nothing can render.
  it("are exactly the system definitions' keys", () => {
    expect([...RESERVED_FIELD_KEYS].sort()).toEqual(
      SYSTEM_FIELD_DEFS.map((def) => def.key).sort(),
    );
  });

  it("reject the label a user would most plausibly collide with", () => {
    expect(isReservedFieldKey(makeCustomFieldKey("V grade"))).toBe(true);
    expect(isReservedFieldKey(makeCustomFieldKey("Quality"))).toBe(true);
    expect(isReservedFieldKey(makeCustomFieldKey("Water level"))).toBe(false);
  });
});

describe("the internal `_` namespace", () => {
  // THE INVARIANT THE WHOLE RESERVATION RESTS ON. `_sources` and `_attributes`
  // are safe from user keys only because `makeCustomFieldKey` cannot produce a
  // leading underscore: it collapses every non-alphanumeric run to `_` and then
  // strips a leading and trailing one. Without this test that is a rule someone
  // has to remember; with it, breaking the slug function fails the build.
  it("cannot be reached by any label a user could type", () => {
    const labels = [
      "_hidden",
      "__dunder__",
      "  leading space",
      "!!! bangs",
      "-dashed-",
      "_",
      "___",
      "_ mixed _",
      "(parenthesised)",
      "🙂 emoji",
      "Ünïcödé",
    ];
    for (const label of labels) {
      const key = makeCustomFieldKey(label);
      expect(
        isInternalFieldValueKey(key),
        `"${label}" slugged to "${key}", which is in the internal namespace`,
      ).toBe(false);
    }
  });

  it("covers the keys the migration parks data under", () => {
    expect(isInternalFieldValueKey(SOURCES_FIELD_KEY)).toBe(true);
    expect(isInternalFieldValueKey(LEGACY_ATTRIBUTES_FIELD_KEY)).toBe(true);
  });

  it("does not claim an ordinary key", () => {
    expect(isInternalFieldValueKey("v_grade")).toBe(false);
    expect(isInternalFieldValueKey("water_temp")).toBe(false);
  });
});

// The set the canyon form and filter draw themselves, and the reason it is not
// `RESERVED_FIELD_KEYS`: both clients used "reserved" as a proxy for "already
// drawn", which deleted the campsite's own system fields from the create form
// and the filter sheet. Pinned so a new canyon-scoped system def has to come
// with a decision about its control rather than silently disappearing.
describe("CANYON_FORM_FIELD_KEYS", () => {
  it("is the seven canyon axes, and nothing else", () => {
    expect([...CANYON_FORM_FIELD_KEYS].sort()).toEqual([
      "a_grade",
      "commitment",
      "hours",
      "longest_abseil",
      "num_abseils",
      "quality",
      "v_grade",
    ]);
  });

  it("does not swallow a system field belonging to another type", () => {
    for (const key of ["capacity", "is_cave"]) {
      expect(RESERVED_FIELD_KEYS.has(key), `${key} is still reserved`).toBe(true);
      expect(
        CANYON_FORM_FIELD_KEYS.has(key),
        `${key} has no control of its own and must render generically`,
      ).toBe(false);
    }
  });
});
