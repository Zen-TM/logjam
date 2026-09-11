// The system place types and the field definitions they carry — ONE
// declaration, read by the API, both clients, the forward migration and the
// dev seed.
//
// System rows sit at `ownerId = null` and are GLOBAL: one row shared by every
// user, not a per-user copy. That is what makes a shared place resolve for its
// recipient with zero reconciliation — the sender's Canyon type IS the
// recipient's Canyon type, so there is no name-matching step and no chance of
// two Canyon tabs.
//
// The ids are PINNED and must stay real UUIDv4s (version nibble 4, variant
// nibble 8). `parsePushOp` validates every client-minted entity id with
// `isUuidV4` and rejects the whole request on a mismatch, so a hand-minted id
// with a version nibble of 0 would make every place of a system type
// permanently unsyncable from the phone — invisibly, because the local mirror
// still updates and only the outbox row holds the 400. That is the seedIds.ts
// incident (root CLAUDE.md); this file is where it would recur.
//
// The migration that creates these rows carries the same literals, because SQL
// cannot import TypeScript. `placeTypes.unit.test.ts` reads the migration and
// fails if the two ever disagree.

import { isUuidV4 } from "./sync.js";
import type { TripLogCustomFieldType } from "./tripLogFields.js";

// PREFIX "b" for system TYPES, "a" for system DEFINITIONS — and neither is a
// prefix the dev seed mints under.
//
// They were both "9" for about an hour, and the seed's first user-created place
// type (`seedId("9", 1)`) came out byte-identical to the Canyon type, which is
// a unique-constraint violation on a good day and a user-owned row shadowing a
// system one on a bad one. `seedIds.unit.test.ts` now asserts the two spaces
// cannot overlap, so this cannot come back quietly.
export const SYSTEM_PLACE_TYPE_IDS = {
  canyon: "b0000000-0000-4000-8000-000000000001",
  campsite: "b0000000-0000-4000-8000-000000000002",
  marker: "b0000000-0000-4000-8000-000000000003",
} as const;

export type SystemPlaceTypeKey = keyof typeof SYSTEM_PLACE_TYPE_IDS;

export type SystemPlaceType = {
  key: SystemPlaceTypeKey;
  id: string;
  name: string;
  iconKey: string;
  color: string;
  position: number;
};

/**
 * EXACTLY THREE, and adding a fourth is a product decision, not a convenience.
 *
 * Trailhead / Peak / Cave / Lookout / Swimming hole / Crag are deliberately
 * absent: they are thirty seconds of user work, and an unused seeded type is a
 * tab that costs every user attention forever. They belong in the empty-state
 * copy of the create-a-type screen, as examples.
 *
 * `Marker` is not a nicety — it is where every existing Waypoint lands in the
 * phase 1c migration, and without it a waypoint that was never about anything
 * has nowhere to go.
 */
export const SYSTEM_PLACE_TYPES: SystemPlaceType[] = [
  {
    key: "canyon",
    id: SYSTEM_PLACE_TYPE_IDS.canyon,
    name: "Canyon",
    iconKey: "droplet",
    color: "#E4C5AA",
    position: 0,
  },
  {
    key: "campsite",
    id: SYSTEM_PLACE_TYPE_IDS.campsite,
    name: "Campsite",
    iconKey: "triangle",
    color: "#BED9B5",
    position: 1,
  },
  {
    key: "marker",
    id: SYSTEM_PLACE_TYPE_IDS.marker,
    name: "Marker",
    iconKey: "map-pin",
    color: "#B7D0E1",
    position: 2,
  },
];

/**
 * The icon grid a user picks from — CURATED, not free text.
 *
 * The two clients draw different icon sets: mobile uses Feather (through
 * @expo/vector-icons), web uses lucide. A free-text key would resolve on one
 * platform and render nothing on the other, and the user who typed it would
 * never see the half that was broken.
 *
 * Every name here is a FEATHER name, because Feather is the smaller set and
 * lucide (a fork of it) keeps them all. That is the direction the constraint
 * runs, and picking a lucide-only name like `waves` or `tent` is exactly the
 * mistake this list exists to make impossible.
 *
 * Guards, one per platform, because neither client can check the other:
 *   mobile/src/places/placeTypeIcons.test.ts   — resolves in Feather's glyph map
 *   frontend/src/placeTypeIcons.test.ts        — resolves in lucide's exports
 */
export const PLACE_TYPE_ICON_KEYS = [
  "map-pin",
  "droplet",
  "triangle",
  "home",
  "flag",
  "star",
  "anchor",
  "compass",
  "navigation",
  "sun",
  "moon",
  "cloud",
  "umbrella",
  "wind",
  "zap",
  "coffee",
  "camera",
  "eye",
  "key",
  "bookmark",
  "truck",
  "heart",
  "circle",
  "square",
] as const;

export type PlaceTypeIconKey = (typeof PLACE_TYPE_ICON_KEYS)[number];

export function isPlaceTypeIconKey(value: unknown): value is PlaceTypeIconKey {
  return (
    typeof value === "string" &&
    (PLACE_TYPE_ICON_KEYS as readonly string[]).includes(value)
  );
}

/**
 * The colour palette a user picks from — CURATED, not a free hex picker, and
 * for a hard reason rather than a taste one.
 *
 * `scripts/wcag-contrast.mjs` asserts that a map marker clears 3:1 against the
 * map background under every theme scheme (WCAG 1.4.11, non-text contrast). An
 * arbitrary user hex would not fail that check — it would DELETE it, because
 * there would be nothing fixed left to check. A curated palette keeps the
 * guarantee and moves the check from two colours to every colour a type can be.
 */
export const PLACE_TYPE_COLORS = [
  // MID-LIGHT AND MUTED, drawn from the NSW canyon palette the theme already
  // speaks in (DESIGN.md §3: "Never a saturated web primary"). The first cut of
  // this list was a Tailwind-500 ramp — orange-500, green-500, blue-400 — which
  // read as a component from another app the moment it sat on a sheet, and had
  // a harder problem underneath: a chip FILLS itself with its type's colour and
  // writes a label on top, and a mid-tone hue carries no legible text in either
  // direction. Every one of those twelve failed WCAG AA on the label (worst
  // 3.17:1 against the sandstone scheme). Light hues carry dark ink; that is
  // what makes the fill usable, and it is why the palette is light rather than
  // merely tasteful. `scripts/wcag-contrast.mjs` asserts both pairs — the chip
  // label at 4.5 and the map marker at 3 — under every scheme.
  //
  // The heath violet is deliberately ABSENT: it is reserved for "shared", which
  // is a different axis (fill = type, ring = shared, §2.8) and must not collide
  // with any type. `placeTypes.test.ts` pins that.
  "#E4C5AA", // banksia orange — Canyon's, the closest to the ink it always had
  "#E3D0AB", // ochre
  "#E2D9AC", // wattle
  "#D5DCB2", // lichen
  "#BED9B5", // scrub green — Campsite's
  "#B5D9C4", // fern
  "#B5D9D6", // pool teal
  "#B7D0E1", // water blue — Marker's
  "#B9C2DF", // dusk blue
  "#E1B7C5", // heath pink
  "#E1BCB7", // clay rose
  "#CDC8C1", // stone — the deliberate neutral
] as const;

/**
 * The ring on a pin someone shared with you, and the tint on every "shared"
 * chip and row. ONE hue for one idea: it was the map's blue and the Places
 * rail's heath at the same time, for the same word.
 *
 * Reserved — never a type colour, or a shared Marker would be a blue dot with a
 * blue ring and the two axes would collapse into one.
 */
export const SHARED_PLACE_COLOR = "#B79EC0";

export type PlaceTypeColor = (typeof PLACE_TYPE_COLORS)[number];

export function isPlaceTypeColor(value: unknown): value is PlaceTypeColor {
  return (
    typeof value === "string" &&
    (PLACE_TYPE_COLORS as readonly string[]).includes(value.toUpperCase())
  );
}

export type SystemFieldDef = {
  id: string;
  key: string;
  label: string;
  type: TripLogCustomFieldType;
  min: number | null;
  max: number | null;
  /** The system types this def is scoped to. */
  placeTypes: SystemPlaceTypeKey[];
};

/**
 * The system field definitions. These are the seven grade/quality columns the
 * Canyon table used to carry, plus the three that make Campsite worth having.
 *
 * Bounds are lifted verbatim from what `PLACE_NUMERIC_CONSTRAINTS` enforced
 * before the columns became field values, so nothing a user could store before
 * becomes invalid now. Note `hours`, `num_abseils` and `longest_abseil` are
 * min-only — which is why one-sided bounds had to become legal
 * (`isTripLogCustomFieldDef`); they were "both or neither" before.
 *
 * `quality` is ONE def shared by Canyon and Campsite, scoped to both through
 * the join table rather than duplicated. That is the per-owner-key rule applied
 * to system defs and it is deliberate: `quality` means one thing wherever it
 * appears, which is what makes per-field copy reconciliation and cross-type
 * filtering coherent. A user who needs a second, differently-bounded field
 * names it differently.
 */
export const SYSTEM_FIELD_DEFS: SystemFieldDef[] = [
  { id: "a0000000-0000-4000-8000-000000000001", key: "v_grade", label: "V grade", type: "integer", min: 1, max: 7, placeTypes: ["canyon"] },
  { id: "a0000000-0000-4000-8000-000000000002", key: "a_grade", label: "A grade", type: "integer", min: 1, max: 7, placeTypes: ["canyon"] },
  { id: "a0000000-0000-4000-8000-000000000003", key: "commitment", label: "Commitment", type: "integer", min: 1, max: 6, placeTypes: ["canyon"] },
  { id: "a0000000-0000-4000-8000-000000000004", key: "quality", label: "Quality", type: "float", min: 1, max: 5, placeTypes: ["canyon", "campsite"] },
  { id: "a0000000-0000-4000-8000-000000000005", key: "hours", label: "Hours", type: "float", min: 0, max: null, placeTypes: ["canyon"] },
  { id: "a0000000-0000-4000-8000-000000000006", key: "num_abseils", label: "Pitches", type: "integer", min: 0, max: null, placeTypes: ["canyon"] },
  { id: "a0000000-0000-4000-8000-000000000007", key: "longest_abseil", label: "Longest pitch", type: "float", min: 0, max: null, placeTypes: ["canyon"] },
  { id: "a0000000-0000-4000-8000-000000000008", key: "capacity", label: "Capacity", type: "integer", min: 0, max: null, placeTypes: ["campsite"] },
  { id: "a0000000-0000-4000-8000-000000000009", key: "is_cave", label: "Is a cave?", type: "boolean", min: null, max: null, placeTypes: ["campsite"] },
  { id: "a0000000-0000-4000-8000-000000000010", key: "has_water", label: "Has a water source?", type: "boolean", min: null, max: null, placeTypes: ["campsite"] },
];

/**
 * Keys a user may not take, DERIVED from the system defs rather than restated.
 *
 * A hardcoded copy is exactly the "two lists that must agree" failure the root
 * CLAUDE.md rule names: a tenth system def would join one list and not the
 * other, and the collision would show up as a RopeWiki import writing a value
 * nothing can render.
 *
 * The reason the reservation exists at all: a user field labelled "V grade" on
 * their Campsite type slugs to `v_grade` through `makeCustomFieldKey`, and
 * would then collide with what RopeWiki import writes into Canyon — two
 * writers, one key, in one owner's namespace.
 */
export const RESERVED_FIELD_KEYS: ReadonlySet<string> = new Set(
  SYSTEM_FIELD_DEFS.map((def) => def.key),
);

/**
 * The system keys a CANYON form draws with a control of its own — the grade
 * rails and the three "how many / how long" thresholds.
 *
 * This is NOT the same set as `RESERVED_FIELD_KEYS`, and conflating the two
 * cost a bug: both clients cut "reserved" keys out of their generic field list
 * on the grounds that the canyon UI renders them, which silently deleted the
 * campsite's own `capacity` and `is a cave?` from the create form and the
 * filter sheet — they are system defs too, and nothing draws them specially.
 * Reserved answers "may a user take this key"; this answers "does some other
 * control already draw it".
 *
 * DERIVED from the canyon scoping rather than restated, so a tenth system def
 * cannot join one list and not the other. `placeTypes.test.ts` pins the
 * membership, which is what forces the decision — a canyon-scoped def with no
 * bespoke control would otherwise vanish from every form that has one.
 */
export const CANYON_FORM_FIELD_KEYS: ReadonlySet<string> = new Set(
  SYSTEM_FIELD_DEFS.filter((def) => def.placeTypes.includes("canyon")).map(
    (def) => def.key,
  ),
);

export function isReservedFieldKey(key: string): boolean {
  return RESERVED_FIELD_KEYS.has(key);
}

/**
 * The one place a rejected key is explained. A bare "that key is reserved"
 * leaves the user renaming by trial and error, so the suggestion is part of the
 * error rather than something each caller invents.
 */
export function reservedFieldKeyError(key: string, label: string): string {
  return `"${label}" is reserved — it is a built-in field. Try a more specific label, like "${label} (mine)".`;
}

/**
 * The key under which structured data that is NOT a custom field is parked:
 * `_sources` for the source links a place carries. (`_attributes`, the bucket
 * the 1b migration first parked the rest of the old `attributes` blob in, is
 * gone — nothing rendered it, so the migration drops those keys instead.)
 *
 * The leading underscore is a STRUCTURAL reservation, not a convention someone
 * has to remember: `makeCustomFieldKey` collapses every non-alphanumeric run to
 * `_` and then strips a leading and trailing one, so a user-authored key can
 * never begin with `_`. `placeTypes.unit.test.ts` pins that property, because
 * the whole guarantee rests on it.
 */
export const INTERNAL_FIELD_VALUE_PREFIX = "_";
export const SOURCES_FIELD_KEY = "_sources";

export function isInternalFieldValueKey(key: string): boolean {
  return key.startsWith(INTERNAL_FIELD_VALUE_PREFIX);
}

/** Every pinned id, for the UUIDv4 guard. */
export function systemRowIds(): string[] {
  return [
    ...SYSTEM_PLACE_TYPES.map((type) => type.id),
    ...SYSTEM_FIELD_DEFS.map((def) => def.id),
  ];
}

export function assertSystemIdsAreUuidV4(): void {
  for (const id of systemRowIds()) {
    if (!isUuidV4(id)) throw new Error(`system row id is not a UUIDv4: ${id}`);
  }
}
