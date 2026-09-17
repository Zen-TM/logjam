import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrlFromEnv } from "../src/lib/databaseUrl";
import { CURRENT_CONSENT_VERSION } from "../src/constants/consent";
import {
  enforceCanyoningTag,
  setFieldValues,
  SOURCES_FIELD_KEY,
  SYSTEM_FIELD_DEFS,
  PLACE_TYPE_COLORS,
  canonicalLinkPair,
  SYSTEM_PLACE_TYPE_IDS,
  SYSTEM_PLACE_TYPES,
  TRACK_COLORS,
} from "@logjam/shared";
import { seedId, cid } from "./seedIds";

const adapter = new PrismaPg({ connectionString: databaseUrlFromEnv() });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Rich synthetic seed (operator-trust plan, Part A).
//
// Goal: realistic volume + edge cases so prod data is never needed to develop
// or debug. Places are well-published NSW classics (drawn from the public
// place list) or deliberately fabricated; ALL trip logs are fabricated.
//
// Test invariants this seed MUST preserve (see api/src/__tests__/_actors.ts):
//   - alice/bob/carol ids + cognito subs (below).
//   - PLACE_IDS[0] === SHARED_PLACE_ID, alice-owned, shared with bob, has >=1
//     trip log. PLACE_IDS[1] also shared with bob. carol is shared NOTHING and
//     is NOT alice's friend (sharing.test.ts asserts a 403 for share->carol).
//   - alice<->bob accepted friendship; carol->alice pending request.
// New data uses fresh ids and never mutates those invariants.
// ---------------------------------------------------------------------------

const ALICE_ID = seedId("0", 1);
const BOB_ID = seedId("0", 2);
const CAROL_ID = seedId("0", 3);

// Matches FAKE_USER_SUB default in auth middleware and the Terraform-generated
// .env.local (infra/terraform/templates/env.local.tftpl)
const ALICE_COGNITO_ID = "fake-alice-sub";
const BOB_COGNITO_ID = "fake-bob-sub";
const CAROL_COGNITO_ID = "fake-carol-sub";

// Stable anchor place ids referenced by the integration suite.
const PLACE_IDS = [
  cid(1), // SHARED_PLACE_ID (shared w/ bob)
  cid(2), // shared w/ bob
  cid(3),
  cid(4),
  cid(5),
];

// Custom-field definitions are ROWS in `custom_field_defs` (they used to live
// on the user's uiPreferences); trip customFields JSON is keyed by these
// `key`s. Ids come from seedId like every other seeded row — the sync push
// path validates op ids with isUuidV4 and rejects the whole request on a
// mismatch, so a hand-written id here would make alice's definitions
// permanently unsyncable from the phone.
/** Marker-place and route ids — prefixes "6" and "7" (prisma/seedIds.ts). The
 * "6" space is the old waypoint space: the phase 1c migration preserved
 * waypoint ids as place ids, so the seed does too. */
const wpid = (n: number) => seedId("6", n);
const rtid = (n: number) => seedId("7", n);

/**
 * The one place BOB shares WITH ALICE. Alice is the fake-auth dev user, so
 * without an incoming share every sharee-perspective surface in the phone app
 * is unreachable in dev — a read-only row, a "From bob" mark, a refused edit.
 * Bob's "Coin Slot" (seedId("2", 2)); see the share block in main().
 */
const BOB_SHARED_PLACE_ID = seedId("2", 2);

// Route geometries, [lon, lat]. Short and plausible rather than traced: a
// route's own validation caps length, and dev only needs a line that draws.
//
// Every line STARTS ON THE PLACE IT BELONGS TO and runs a kilometre or two
// downstream from it, so opening a way centres the map on ground that matches
// its name. They used to wander: the Claustral file's extent sat 15 km from
// Claustral, which is the sort of thing that reads as a broken app rather than
// as thin fixtures (operator, 2026-09-17).
const CLAUSTRAL_LINE: [number, number][] = [
  [150.4033, -33.5603],
  [150.4041, -33.5611],
  [150.4052, -33.5620],
  [150.4066, -33.5629],
  [150.4078, -33.5641],
  [150.4089, -33.5653],
  [150.4097, -33.5666],
  [150.4101, -33.5680],
  [150.4098, -33.5694],
  [150.4089, -33.5707],
];

const DU_FAUR_LINE: [number, number][] = [
  [150.3298, -33.5121],
  [150.3310, -33.5128],
  [150.3322, -33.5136],
  [150.3334, -33.5145],
  [150.3343, -33.5153],
  [150.3351, -33.5162],
];

const COIN_SLOT_LINE: [number, number][] = [
  [150.3271, -33.1198],
  [150.3282, -33.1207],
  [150.3290, -33.1216],
  [150.3297, -33.1224],
  [150.3303, -33.1233],
  [150.3308, -33.1243],
];

const BUTTERBOX_LINE: [number, number][] = [
  [150.3970, -33.6304],
  [150.3979, -33.6313],
  [150.3986, -33.6324],
  [150.3991, -33.6336],
  [150.3993, -33.6349],
  [150.3990, -33.6362],
];

const GRAND_CANYON_LINE: [number, number][] = [
  [150.3179, -33.6563],
  [150.3188, -33.6572],
  [150.3199, -33.6580],
  [150.3212, -33.6586],
  [150.3226, -33.6590],
  [150.3241, -33.6591],
  [150.3255, -33.6588],
];

const WOLLANGAMBE_LINE: [number, number][] = [
  [150.3587, -33.4888],
  [150.3601, -33.4896],
  [150.3617, -33.4903],
  [150.3634, -33.4908],
  [150.3652, -33.4911],
  [150.3670, -33.4912],
  [150.3688, -33.4910],
  [150.3705, -33.4905],
];

const KANANGRA_LINE: [number, number][] = [
  [150.0991, -33.9809],
  [150.1005, -33.9818],
  [150.1018, -33.9829],
  [150.1029, -33.9842],
  [150.1036, -33.9856],
];

// `appliesToAllTypes` SPELLED OUT, not left to the column default: a definition
// with the flag off and no place types scoped to it appears on no form at all,
// and a trip-log definition has no type picker to answer the question with. The
// seed wrote all three with the default and they were invisible on the trip
// form until 20260911140000 repaired them.
const ALICE_TRIP_FIELD_DEFS = [
  { key: "water_level", label: "Water Level", type: "string", appliesToAllTypes: true },
  { key: "rope_length_m", label: "Rope Length (m)", type: "integer", appliesToAllTypes: true },
  { key: "wetsuit", label: "Wetsuit", type: "boolean", appliesToAllTypes: true },
];

// A place type ALICE made herself, so copy reconciliation (§2.6) is
// exercisable in dev: bob receiving a copy of one of these has to match it by
// NAME against his own types, and there is no way to try that without a user
// type existing.
const ALICE_TYPE_ID = seedId("9", 1);

// Place-scoped definitions alice owns. `access_beta` is scoped to her own type;
// `permit_no` is `appliesToAllTypes`, which is the flag a new type inherits for
// free — the case join rows cannot express.
//
// NONE of these may use a reserved key: `assertKeyNotReserved` refuses them on
// the API path, and the seed writing one directly would create the exact
// two-writers-one-key state the reservation exists to prevent.
const ALICE_PLACE_FIELD_DEFS = [
  {
    id: seedId("5", 10),
    key: "access_beta",
    label: "Access beta",
    type: "string",
    placeTypeIds: [ALICE_TYPE_ID],
    appliesToAllTypes: false,
  },
  {
    id: seedId("5", 11),
    key: "permit_no",
    label: "Permit number",
    type: "string",
    placeTypeIds: [] as string[],
    appliesToAllTypes: true,
  },
];

type SeedPlace = {
  id: string;
  ownerId: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Defaults to the system Canyon type. */
  placeTypeId?: string;
  numAbseils?: number;
  longestAbseil?: number;
  vGrade?: number;
  aGrade?: number;
  commitment?: number;
  quality?: number;
  hours?: number;
  notes?: string;
  altNames?: string[];
  /** Extra field values beyond the grades — user-defined fields, sources. */
  fieldValues?: Record<string, unknown>;
  ropeWikiId?: number;
  ropeWikiSnapshot?: Prisma.InputJsonValue;
  forkedFromId?: string;
};

// `sandstone()` IS GONE. It wrote `rockType` and `wetsuit` into the attributes
// blob — two keys the owner added early, decided were too niche, and has asked
// to have dropped. They were never declared in TPlaceAttributes either, so the
// seed was the only thing that made them look like part of the model. Anyone
// who wants them adds them back as ordinary custom fields, which is what they
// always should have been.
//
// What replaces it is `sources()`: the one non-customFields key that survives,
// under the reserved `_sources` key.
const sources = (...entries: [string, string][]): Record<string, unknown> => ({
  [SOURCES_FIELD_KEY]: entries,
});

const ALICE_PLACES: SeedPlace[] = [
  // --- anchors (ids referenced by tests) ---
  { id: PLACE_IDS[0], ownerId: ALICE_ID, name: "Grand Canyon", latitude: -33.6563, longitude: 150.3179, numAbseils: 1, longestAbseil: 20, vGrade: 2, aGrade: 2, commitment: 3, quality: 3.4, hours: 3, fieldValues: {} },
  { id: PLACE_IDS[1], ownerId: ALICE_ID, name: "Claustral Canyon", latitude: -33.5603, longitude: 150.4033, numAbseils: 6, longestAbseil: 15, vGrade: 3, aGrade: 3, commitment: 3, quality: 4.9, hours: 9, fieldValues: {} },
  { id: PLACE_IDS[2], ownerId: ALICE_ID, name: "Empress Falls", latitude: -33.72, longitude: 150.3625, numAbseils: 1, longestAbseil: 28, vGrade: 3, aGrade: 2, commitment: 2, quality: 3, hours: 2.5, altNames: ["Valley-of-the-Waters"], fieldValues: {} },
  { id: PLACE_IDS[3], ownerId: ALICE_ID, name: "Hidden Slot", latitude: -33.701, longitude: 150.302, quality: 3, notes: "Fabricated test place — not a real location.", fieldValues: {} },
  { id: PLACE_IDS[4], ownerId: ALICE_ID, name: "Deep Pass", latitude: -33.3396, longitude: 150.3076, numAbseils: 0, vGrade: 1, aGrade: 2, quality: 2, hours: 3, fieldValues: {} },

  // --- more published classics ---
  { id: cid(6), ownerId: ALICE_ID, name: "Butterbox Canyon", latitude: -33.6304, longitude: 150.397, numAbseils: 11, longestAbseil: 20, vGrade: 4, aGrade: 2, commitment: 4, quality: 3.9, hours: 6.5, altNames: ["Mt Hay"], fieldValues: sources(["OzUltimate", "https://ozultimate.com/canyoning/track_notes/mt_hay.htm"]) },
  { id: cid(7), ownerId: ALICE_ID, name: "Hole-in-the-Wall", latitude: -33.3754, longitude: 150.3292, numAbseils: 5, longestAbseil: 15, vGrade: 2, aGrade: 2, commitment: 3, quality: 4.4, hours: 7, fieldValues: {} },
  { id: cid(8), ownerId: ALICE_ID, name: "Fortress Canyon", latitude: -33.6445, longitude: 150.3593, numAbseils: 2, longestAbseil: 6, vGrade: 2, aGrade: 2, quality: 2.5, hours: 6, fieldValues: {} },
  { id: cid(9), ownerId: ALICE_ID, name: "Whungee Wheengee", latitude: -33.4757, longitude: 150.3742, numAbseils: 7, longestAbseil: 15, vGrade: 2, aGrade: 2, quality: 4, altNames: ["The Green Room"], fieldValues: {} },
  { id: cid(10), ownerId: ALICE_ID, name: "Dione Dell", latitude: -34.0027, longitude: 150.0909, numAbseils: 6, longestAbseil: 25, vGrade: 3, aGrade: 2, commitment: 2, quality: 2.2, hours: 6, altNames: ["Upper Christys Creek"] },
  { id: cid(11), ownerId: ALICE_ID, name: "Tiger Snake Canyon", latitude: -33.2214, longitude: 150.2527, numAbseils: 5, longestAbseil: 25, vGrade: 2, aGrade: 1, commitment: 2, quality: 3.8, hours: 7, altNames: ["Bottleneck"], fieldValues: {} },
  { id: cid(12), ownerId: ALICE_ID, name: "Rocky Creek Canyon", latitude: -33.2878, longitude: 150.2932, numAbseils: 0, vGrade: 1, aGrade: 2, commitment: 2, quality: 4.2, hours: 4.5, fieldValues: {} },
  { id: cid(13), ownerId: ALICE_ID, name: "Twister Canyon", latitude: -33.2876, longitude: 150.2864, numAbseils: 0, vGrade: 2, aGrade: 2, commitment: 2, quality: 3.4, hours: 2, altNames: ["Sheep Dip"], fieldValues: {} },
  // null grades edge case (quality only)
  { id: cid(14), ownerId: ALICE_ID, name: "Wollangambe One", latitude: -33.4888, longitude: 150.3587, numAbseils: 0, quality: 2.5, hours: 7, fieldValues: {} },
  { id: cid(15), ownerId: ALICE_ID, name: "Bell Creek Canyon", latitude: -33.4999, longitude: 150.3371, vGrade: 1, aGrade: 1, commitment: 4, quality: 4.5, hours: 9, fieldValues: {} },
  { id: cid(16), ownerId: ALICE_ID, name: "Arethusa Canyon", latitude: -33.6589, longitude: 150.3467, numAbseils: 6, longestAbseil: 30, vGrade: 4, aGrade: 4, commitment: 3, quality: 4, hours: 9, fieldValues: {} },
  { id: cid(17), ownerId: ALICE_ID, name: "Starlight Canyon", latitude: -33.1516, longitude: 150.2844, numAbseils: 3, longestAbseil: 25, vGrade: 2, aGrade: 1, quality: 4.5, hours: 9, altNames: ["Newnes", "Wallaby Tunnel"], fieldValues: {} },
  { id: cid(18), ownerId: ALICE_ID, name: "Kanangra Main", latitude: -33.9809, longitude: 150.0991, numAbseils: 17, longestAbseil: 58, vGrade: 4, aGrade: 3, commitment: 5, quality: 4.6, hours: 12, altNames: ["Kanangra Falls"], fieldValues: {} },
  // ropewiki snapshot edge cases
  { id: cid(19), ownerId: ALICE_ID, name: "Yileen Canyon", latitude: -33.5666, longitude: 150.3295, numAbseils: 6, longestAbseil: 50, vGrade: 4, aGrade: 2, commitment: 2, quality: 3, hours: 3.5, ropeWikiId: 90019, ropeWikiSnapshot: { name: "Yileen", region: "Wollemi", quality: 3, rating: "4C2 IV", rappels: 6, longestRappelFt: 164, fetchedAt: "2025-11-02T00:00:00.000Z" }, fieldValues: sources(["RopeWiki", "https://ropewiki.com/Yileen"]) },
  { id: cid(20), ownerId: ALICE_ID, name: "Serendipity Canyon", latitude: -33.4947, longitude: 150.3812, numAbseils: 6, longestAbseil: 20, vGrade: 2, aGrade: 2, commitment: 3, quality: 3.4, hours: 4, altNames: ["Why Don't We Do It In The Road"], ropeWikiId: 90020, ropeWikiSnapshot: { name: "Serendipity", region: "Blue Mountains", quality: 3, rating: "3C2", rappels: 6, fetchedAt: "2025-11-02T00:00:00.000Z" }, fieldValues: sources(["RopeWiki", "https://ropewiki.com/Serendipity"]) },
  // all-null grades + quality
  { id: cid(21), ownerId: ALICE_ID, name: "Devils Pinch", latitude: -33.1606, longitude: 150.2754, numAbseils: 6, longestAbseil: 30, quality: 4.5, hours: 9, fieldValues: {} },
  { id: cid(22), ownerId: ALICE_ID, name: "Du Faur Creek", latitude: -33.5153, longitude: 150.3343, numAbseils: 0, vGrade: 1, aGrade: 2, commitment: 3, quality: 3.5, hours: 10, altNames: ["Clatterteeth"], fieldValues: {} },
  { id: cid(23), ownerId: ALICE_ID, name: "Heart Attack Canyon", latitude: -33.2383, longitude: 150.3029, numAbseils: 6, longestAbseil: 37, vGrade: 4, aGrade: 1, commitment: 4, quality: 4, hours: 10, fieldValues: {} },
  { id: cid(24), ownerId: ALICE_ID, name: "Jugglers Canyon", latitude: -33.6592, longitude: 150.3294, numAbseils: 8, longestAbseil: 20, vGrade: 3, aGrade: 1, commitment: 2, quality: 2.3, hours: 4, altNames: ["Pilcher"], fieldValues: {} },
  { id: cid(25), ownerId: ALICE_ID, name: "Sarcophagus Canyon", latitude: -33.5693, longitude: 150.3235, numAbseils: 7, longestAbseil: 25, vGrade: 3, aGrade: 1, quality: 2.8, hours: 8, ropeWikiId: 90025, ropeWikiSnapshot: { name: "Sarcophagus", region: "Blue Mountains", quality: 2.8, rating: "3C1", rappels: 7, fetchedAt: "2025-11-02T00:00:00.000Z" }, fieldValues: {} },
  { id: cid(26), ownerId: ALICE_ID, name: "Bowens Creek North (Lower)", latitude: -33.5215, longitude: 150.3932, numAbseils: 3, longestAbseil: 12, vGrade: 2, aGrade: 2, commitment: 3, quality: 3.4, hours: 6, altNames: ["Gobsmacker"], fieldValues: {} },
  { id: cid(27), ownerId: ALICE_ID, name: "Crayfish Creek", latitude: -33.5976, longitude: 150.3037, numAbseils: 0, vGrade: 1, aGrade: 2, quality: 1.5, hours: 7, fieldValues: {} },
  // second fabricated place
  { id: cid(28), ownerId: ALICE_ID, name: "Test Gorge", latitude: -33.55, longitude: 150.28, numAbseils: 2, longestAbseil: 10, quality: 2, notes: "Fabricated place for local development.", fieldValues: {} },

  // ── the field machinery, made visible in dev ─────────────────────────────
  //
  // Before the places rework NO seeded place carried a custom-field value, so
  // the shape every prod canyon may hold was invisible here and the migration's
  // hoist had to be proved against a hand-built fixture instead of dev data.
  // These three make each case reachable by opening the app:
  //
  //  * a canyon carrying a user-defined value on the system type
  //    (`permit_no`, which is appliesToAllTypes — the flag a new type inherits)
  //  * a place of a USER type carrying a value scoped to that type, which is
  //    what a copy has to reconcile (§2.6)
  //  * a place of a SYSTEM type that is not Canyon, so the Places screen has
  //    more than one populated tab and the zero-places hide rule is observable
  { id: cid(29), ownerId: ALICE_ID, name: "Rocky Creek Canyon", latitude: -33.4487, longitude: 150.3311, numAbseils: 4, longestAbseil: 18, vGrade: 3, aGrade: 2, commitment: 3, quality: 3.2, hours: 5, fieldValues: { permit_no: "NPWS-2026-114" } },
  { id: cid(30), ownerId: ALICE_ID, name: "Wollangambe Crater", latitude: -33.4602, longitude: 150.2588, placeTypeId: ALICE_TYPE_ID, quality: 4, fieldValues: { access_beta: "Park at the locked gate, walk the fire trail 20 min." } },
  { id: cid(31), ownerId: ALICE_ID, name: "Newnes camp", latitude: -33.2074, longitude: 150.2247, placeTypeId: SYSTEM_PLACE_TYPE_IDS.campsite, quality: 4, fieldValues: { capacity: 12, is_cave: false } },
];

// bob owns a fork of alice's shared Grand Canyon + two of his own.
const BOB_PLACES: SeedPlace[] = [
  { id: seedId("2", 1), ownerId: BOB_ID, name: "Grand Canyon (copy)", latitude: -33.6563, longitude: 150.3179, numAbseils: 1, longestAbseil: 20, vGrade: 2, aGrade: 2, commitment: 3, quality: 3.4, hours: 3, forkedFromId: PLACE_IDS[0], fieldValues: {} },
  { id: seedId("2", 2), ownerId: BOB_ID, name: "Coin Slot", latitude: -33.1224, longitude: 150.3297, numAbseils: 5, longestAbseil: 35, vGrade: 3, aGrade: 1, commitment: 4, quality: 4, hours: 3.5, fieldValues: {} },
  { id: seedId("2", 3), ownerId: BOB_ID, name: "Galah Canyon", latitude: -33.2514, longitude: 150.3037, numAbseils: 8, longestAbseil: 30, quality: 4, hours: 10, fieldValues: {} },
];

// carol owns her own places (and is shared nothing of alice's — the stranger).
const CAROL_PLACES: SeedPlace[] = [
  { id: seedId("3", 1), ownerId: CAROL_ID, name: "Pipeline Canyon", latitude: -33.1658, longitude: 150.2634, numAbseils: 10, longestAbseil: 25, quality: 4, hours: 7, fieldValues: {} },
  { id: seedId("3", 2), ownerId: CAROL_ID, name: "Surefire Canyon", latitude: -33.2286, longitude: 150.2926, numAbseils: 5, longestAbseil: 15, quality: 4.5, hours: 12, fieldValues: {} },
];

const ALL_PLACES = [...ALICE_PLACES, ...BOB_PLACES, ...CAROL_PLACES];

// Deterministic fabricated trip-log generator.
const PARTIES = [
  ["Pete", "Sam"],
  ["Dad", "Pete"],
  ["Jess", "Marco", "Lou"],
  ["solo"],
  ["Kim", "Ada"],
  ["Tom", "Ben", "Priya", "Nadia"],
];
const NOTE_TEMPLATES = [
  "Cold swims but a beautiful day. Water level moderate.",
  "Quick lap before lunch. Bone dry, no wetsuit needed.",
  "First time down this one — bigger than expected.",
  "Heavy flow after rain, turned around at the third abseil.",
  "Classic trip. Glow worms in the dark section were incredible.",
  "Anchors all in good shape. Logged for the record.",
  "Long car shuffle but worth it. Stunning constriction.",
  "Slow group, finished in the dark. Bring more layers next time.",
];
const WATER = ["low", "moderate", "high"];

// Spread dates across several years deterministically.
function tripDate(seed: number): Date {
  const year = 2019 + (seed % 7); // 2019..2025
  const month = (seed * 7) % 12; // 0..11
  const day = 1 + ((seed * 13) % 27); // 1..27
  return new Date(Date.UTC(year, month, day));
}

type SeedTrip = {
  placeId: string | null;
  userId: string;
  date: Date;
  displayName?: string;
  notes: string;
  customFields?: Prisma.InputJsonValue;
};

function buildTrips(): SeedTrip[] {
  const trips: SeedTrip[] = [];
  let seed = 0;

  // alice: 3-4 trips per place, with rotating parties/notes and occasional
  // custom fields.
  for (const place of ALICE_PLACES) {
    const count = 3 + (seed % 2); // 3 or 4
    for (let i = 0; i < count; i++) {
      seed++;
      const party = PARTIES[seed % PARTIES.length];
      const withFields = seed % 3 === 0;
      trips.push({
        placeId: place.id,
        userId: ALICE_ID,
        date: tripDate(seed),
        notes: `${NOTE_TEMPLATES[seed % NOTE_TEMPLATES.length]} Party: ${party.join(", ")}.`,
        customFields: withFields
          ? {
              // NOT `seed % WATER.length`: the gate above is `seed % 3` and
              // WATER has three entries, so that expression is zero every time
              // it is reached — every seeded trip got "low" and the vocabulary
              // tally rendered as a single row. Any sampling index has to be
              // coprime with the gate that decides whether it runs at all.
              water_level: WATER[(seed / 3) % WATER.length | 0],
              // TYPED to match their definitions, not stringified. A value of
              // the wrong type READS AS ABSENT everywhere (the forgiving-read
              // rule in shared/src/fieldValues.ts), so a stringified integer is
              // not a harmless variation — it is a value no reader can use.
              // Seeded as strings until 2026-09-13, which made two of alice's
              // three trip attributes invisible to anything that aggregates
              // them while still rendering as text on the trip screen.
              rope_length_m: 15 + ((seed * 5) % 50),
              wetsuit: seed % 2 === 0,
            }
          : undefined,
      });
    }
  }

  // alice: named no-place trips (displayName set, placeId null).
  for (const name of ["Newnes weekend (multi-place)", "Kanangra exploratory", "Wollangambe float", "Rescue practice day"]) {
    seed++;
    trips.push({
      placeId: null,
      userId: ALICE_ID,
      date: tripDate(seed),
      displayName: name,
      notes: `${NOTE_TEMPLATES[seed % NOTE_TEMPLATES.length]} (No single place — logged by name.)`,
    });
  }

  // bob: trips on his own places + one named no-place trip.
  for (const place of BOB_PLACES) {
    for (let i = 0; i < 3; i++) {
      seed++;
      trips.push({
        placeId: place.id,
        userId: BOB_ID,
        date: tripDate(seed),
        notes: `${NOTE_TEMPLATES[seed % NOTE_TEMPLATES.length]} Party: ${PARTIES[seed % PARTIES.length].join(", ")}.`,
      });
    }
  }
  seed++;
  trips.push({ placeId: null, userId: BOB_ID, date: tripDate(seed), displayName: "Canyoning festival 2024", notes: "Three places in a day. Logged as one entry." });

  // carol: trips on her own places.
  for (const place of CAROL_PLACES) {
    for (let i = 0; i < 3; i++) {
      seed++;
      trips.push({
        placeId: place.id,
        userId: CAROL_ID,
        date: tripDate(seed),
        notes: `${NOTE_TEMPLATES[seed % NOTE_TEMPLATES.length]} Party: ${PARTIES[seed % PARTIES.length].join(", ")}.`,
      });
    }
  }

  return trips;
}

async function main() {
  // Delete in reverse FK dependency order (Postgres enforces constraints per
  // statement). Every seeded table is NAMED here even where `user.deleteMany()`
  // would cascade it: this is a hand-kept list that must agree with what the
  // seed writes, and relying on cascade order means a future table with no user
  // FK survives the wipe silently — the ARCH-001 shape in the root CLAUDE.md.
  // Guarded by src/lib/seedWipe.unit.test.ts.
  await prisma.$transaction([
    prisma.share.deleteMany(),
    prisma.placeShare.deleteMany(),
    prisma.friendship.deleteMany(),
    prisma.media.deleteMany(),
    prisma.tripLog.deleteMany(),
    prisma.placeLink.deleteMany(),
    prisma.route.deleteMany(),
    prisma.place.deleteMany(),
    prisma.customFieldDefPlaceType.deleteMany(),
    prisma.customFieldDef.deleteMany(),
    prisma.placeType.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.topoJob.deleteMany(),
    prisma.geoPdfTemplate.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const consentedAt = new Date("2026-01-15T00:00:00.000Z");
  await prisma.user.createMany({
    data: [
      {
        id: ALICE_ID,
        cognitoId: ALICE_COGNITO_ID,
        username: "alice",
        email: "alice@local",
        consentedAt,
        consentVersion: CURRENT_CONSENT_VERSION,
        uiPreferences: { autoDownloadGeoPdfs: false },
      },
      { id: BOB_ID, cognitoId: BOB_COGNITO_ID, username: "bob", email: "bob@local", consentedAt, consentVersion: CURRENT_CONSENT_VERSION },
      { id: CAROL_ID, cognitoId: CAROL_COGNITO_ID, username: "carol", email: "carol@local", consentedAt, consentVersion: CURRENT_CONSENT_VERSION },
    ],
  });

  // ── system place types and their definitions ─────────────────────────────
  //
  // The WIPE above removes these, so the seed has to put them back — and it
  // must put back exactly what the forward migration creates, ids included,
  // or a dev database and a migrated one disagree about what the Canyon type
  // IS. Both read the same declaration in shared/src/placeTypes.ts; nothing
  // here is a literal.
  await prisma.placeType.createMany({
    data: SYSTEM_PLACE_TYPES.map((type) => ({
      id: type.id,
      ownerId: null,
      name: type.name,
      iconKey: type.iconKey,
      color: type.color,
      position: type.position,
    })),
  });
  await prisma.customFieldDef.createMany({
    data: SYSTEM_FIELD_DEFS.map((def, position) => ({
      id: def.id,
      ownerId: null,
      entity: "place",
      key: def.key,
      label: def.label,
      type: def.type,
      min: def.min,
      max: def.max,
      position,
    })),
  });
  await prisma.customFieldDefPlaceType.createMany({
    data: SYSTEM_FIELD_DEFS.flatMap((def) =>
      def.placeTypes.map((key) => ({
        defId: def.id,
        placeTypeId: SYSTEM_PLACE_TYPE_IDS[key],
      })),
    ),
  });

  // A type alice made herself, so a copy of one of her places has a USER type
  // to reconcile rather than a system one that resolves for free.
  await prisma.placeType.create({
    data: {
      id: ALICE_TYPE_ID,
      ownerId: ALICE_ID,
      name: "Swimming hole",
      iconKey: "droplet",
      // From the curated palette, like any type a user could make — the seed
      // must not be the one row that fails `isPlaceTypeColor`.
      color: PLACE_TYPE_COLORS[6],
      position: 0,
    },
  });

  await prisma.customFieldDef.createMany({
    data: ALICE_TRIP_FIELD_DEFS.map((def, position) => ({
      id: seedId("5", position + 1),
      ownerId: ALICE_ID,
      entity: "tripLog",
      ...def,
      position,
    })),
  });

  // Place-scoped definitions alice owns, plus their scoping rows. This is what
  // makes the field machinery VISIBLE in dev: before the places rework the seed
  // had no place-scoped definitions and no place carried a custom-field value
  // at all, so the nested `attributes.customFields` shape that every prod
  // canyon may hold was invisible here — which is why the migration's hoist had
  // to be proved against a hand-built fixture rather than against dev data.
  for (const [position, def] of ALICE_PLACE_FIELD_DEFS.entries()) {
    await prisma.customFieldDef.create({
      data: {
        id: def.id,
        ownerId: ALICE_ID,
        entity: "place",
        key: def.key,
        label: def.label,
        type: def.type,
        position,
        appliesToAllTypes: def.appliesToAllTypes,
        ...(def.placeTypeIds.length
          ? {
              placeTypes: {
                create: def.placeTypeIds.map((placeTypeId) => ({ placeTypeId })),
              },
            }
          : {}),
      },
    });
  }

  // Friendships: alice<->bob accepted (invariant), carol->alice pending
  // (invariant), bob<->carol accepted (extra graph; does NOT make carol alice's
  // friend, so the share->carol 403 test still holds).
  await prisma.friendship.create({ data: { requesterId: ALICE_ID, addresseeId: BOB_ID, status: "accepted" } });
  const carolPending = await prisma.friendship.create({ data: { requesterId: CAROL_ID, addresseeId: ALICE_ID, status: "pending" } });
  await prisma.friendship.create({ data: { requesterId: BOB_ID, addresseeId: CAROL_ID, status: "accepted" } });

  // Places. Forks reference an existing id, so insert non-forks first.
  for (const c of ALL_PLACES.filter((c) => !c.forkedFromId)) {
    await prisma.place.create({ data: placeCreate(c) });
  }
  for (const c of ALL_PLACES.filter((c) => c.forkedFromId)) {
    await prisma.place.create({ data: placeCreate(c) });
  }

  // Shares: anchors 0 & 1 (invariant) + two more, all alice->bob. carol gets none.
  await prisma.placeShare.createMany({
    data: [PLACE_IDS[0], PLACE_IDS[1], cid(6), cid(9)].map((placeId) => ({
      placeId,
      sharedById: ALICE_ID,
      sharedWithId: BOB_ID,
    })),
  });

  // ONE bob->alice place share, so the dev user has an INCOMING share and not
  // only outgoing ones. Without it alice can never see a row she does not own,
  // and every sharee-perspective surface in the phone app — a read-only
  // waypoint, a "From bob" mark, a refused delete — is unreachable in dev.
  // Deliberately bob's "Coin Slot" and not his FORK of Grand Canyon, which
  // would sit next to alice's own copy of the same place and read as a bug.
  await prisma.placeShare.create({
    data: {
      placeId: BOB_SHARED_PLACE_ID,
      sharedById: BOB_ID,
      sharedWithId: ALICE_ID,
    },
  });

  // MARKER places and routes. The seed had NO waypoints or routes at all until
  // they were added for the Saved share marks; waypoints are places of the
  // system Marker type since phase 1c, so what was five waypoints is five more
  // places here.
  //
  // The set covers every combination the row builders branch on:
  //   owned, unshared            → no mark
  //   owned + a place share      → the fan-out glyph
  //   received via place share   → "From bob": the owner resolves through the
  //                                mirrored place_shares row.
  //
  // `symbol` is gone with the fold — the icon is the place TYPE's now — and the
  // notes came across unchanged.
  await prisma.place.createMany({
    data: [
      { id: wpid(1), ownerId: ALICE_ID, placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker, name: "Grand Canyon carpark", latitude: -33.6501, longitude: 150.3122, elevation: 1010 },
      { id: wpid(2), ownerId: ALICE_ID, placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker, name: "Claustral first abseil", latitude: -33.5611, longitude: 150.4041, elevation: 880, notes: "Tree anchor on the true left." },
      { id: wpid(3), ownerId: ALICE_ID, placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker, name: "Ranger station", latitude: -33.7188, longitude: 150.3099 },
      { id: wpid(4), ownerId: BOB_ID, placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker, name: "Coin Slot pothole", latitude: -33.1231, longitude: 150.3288, elevation: 720, notes: "Bob's note — a sharee must not be able to edit this." },
      { id: wpid(5), ownerId: BOB_ID, placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker, name: "Galah exit gully", latitude: -33.2521, longitude: 150.3044 },
    ],
  });

  // Links between places — navigational only. A link grants NO visibility, so
  // wpid(4) does NOT reach alice through bob's shared place any more: she sees
  // the place she was shared, and nothing it points at. Both endpoints of every
  // link belong to one owner, which the server asserts on create.
  await prisma.placeLink.createMany({
    data: [
      { id: seedId("6", 101), ownerId: ALICE_ID, ...canonicalLinkPair(PLACE_IDS[0], wpid(1)) },
      { id: seedId("6", 102), ownerId: ALICE_ID, ...canonicalLinkPair(PLACE_IDS[1], wpid(2)) },
      { id: seedId("6", 103), ownerId: BOB_ID, ...canonicalLinkPair(BOB_SHARED_PLACE_ID, wpid(4)) },
    ],
  });

  // A place holds ONE way — a drawn route or an attached file, never both
  // (shared/mobile routeSlot.ts, and assertPlaceTrackSlotFree on the media
  // side). The seed used to put a route AND a track file on Claustral and on
  // Coin Slot, which no client can produce. Each place below carries at most
  // one, and the places that carry a FILE are named in the media block.
  await prisma.route.createMany({
    data: [
      { id: rtid(1), ownerId: ALICE_ID, placeId: PLACE_IDS[1], name: "Claustral through-trip", color: TRACK_COLORS[3], points: CLAUSTRAL_LINE, anchors: [0, 4, CLAUSTRAL_LINE.length - 1] },
      { id: rtid(2), ownerId: ALICE_ID, placeId: null, name: "Du Faur Head approach", color: TRACK_COLORS[4], points: DU_FAUR_LINE, anchors: Prisma.DbNull },
      // Bob's route is UNLINKED now, so his Coin Slot can carry the track file
      // below. It keeps its direct share to alice, which is the whole point of
      // it: a route shared with you on its own row, removable by you.
      { id: rtid(3), ownerId: BOB_ID, placeId: null, name: "Coin Slot approach", color: TRACK_COLORS[5], points: COIN_SLOT_LINE, anchors: [0, COIN_SLOT_LINE.length - 1] },
      { id: rtid(4), ownerId: ALICE_ID, placeId: cid(6), name: "Butterbox descent", color: TRACK_COLORS[6], points: BUTTERBOX_LINE, anchors: [0, 3, BUTTERBOX_LINE.length - 1] },
      { id: rtid(5), ownerId: ALICE_ID, placeId: PLACE_IDS[0], name: "Grand Canyon descent", color: TRACK_COLORS[7], points: GRAND_CANYON_LINE, anchors: [0, GRAND_CANYON_LINE.length - 1] },
      { id: rtid(6), ownerId: ALICE_ID, placeId: cid(14), name: "Wollangambe One float", color: TRACK_COLORS[8], points: WOLLANGAMBE_LINE, anchors: [0, 4, WOLLANGAMBE_LINE.length - 1] },
      { id: rtid(7), ownerId: ALICE_ID, placeId: null, name: "Kanangra tops walk in", color: TRACK_COLORS[9], points: KANANGRA_LINE, anchors: Prisma.DbNull },
    ],
  });

  // Direct per-item shares — the second, independent visibility source
  // (lib/shareAccess.ts), and the only thing that puts a number in a ROUTE's
  // sharedCount. A place is never shared this way (PlaceShare is its own
  // table), and a waypoint no longer exists to be, so what was three rows is
  // one. alice's fan-out is 1 because bob is her only friend: carol is shared
  // nothing and is not her friend, and sharing.test.ts asserts a 403 on
  // share->carol.
  await prisma.share.createMany({
    data: [
      { id: seedId("8", 2), entityType: "route", entityId: rtid(1), sharedById: ALICE_ID, sharedWithId: BOB_ID },
      // The INCOMING direction, so every sharee-perspective surface (a
      // read-only row, a "Shared with you" mark, a refused delete) is
      // reachable in dev without hand-creating data as two users.
      { id: seedId("8", 3), entityType: "route", entityId: rtid(3), sharedById: BOB_ID, sharedWithId: ALICE_ID },
    ],
  });

  // Trip logs. `types` goes through enforceCanyoningTag, the same derivation
  // POST /trips applies — the seed writes via Prisma directly and so bypasses
  // the route's enforcement, which would otherwise leave every seeded trip
  // untagged and make dev the one environment where the trip-type filter has
  // an empty vocabulary.
  const trips = buildTrips();
  for (const t of trips) {
    await prisma.tripLog.create({
      data: {
        userId: t.userId,
        date: t.date,
        displayName: t.displayName,
        notes: t.notes,
        types: enforceCanyoningTag([], Boolean(t.placeId)),
        ...(t.customFields ? { customFields: t.customFields } : {}),
        ...(t.placeId
          ? { places: { create: [{ placeId: t.placeId, position: 0 }] } }
          : {}),
      },
    });
  }

  // Media (metadata only — no S3 objects exist locally, so thumbnails won't
  // load; the rows exist to populate media-list code paths).
  //
  // Covers all three parent states, because they behave differently and only
  // the first one used to exist: a photo ATTACHED to a place (dies with it), a
  // standalone import LINKED as a place's way (survives the place, and is the
  // shape a sharee sees), and an unlinked recording (owner-private, in Saved
  // and nowhere else). A seed with only attachments leaves every standalone
  // path untested by the integration suite.
  await prisma.media.createMany({
    data: [
      { id: seedId("4", 1), ownerId: ALICE_ID, linkedType: "place", linkedId: PLACE_IDS[0], s3KeyDisplay: "media/seed/grand-1.jpg", s3KeyThumbnail: "media/seed/grand-1-thumb.jpg", mediaType: "image/jpeg", filename: "grand-canyon.jpg", fileSizeBytes: BigInt(2_048_000) },
      // Empress Falls carries a FILE as its way (no route is linked to it), and
      // its extent sits on Empress Falls. Every bbox below brackets the place
      // it belongs to: a file whose extent is nowhere near its own name is what
      // made the old fixtures read as broken data.
      { id: seedId("4", 2), ownerId: ALICE_ID, linkedType: "place", linkedId: PLACE_IDS[2], s3KeyDisplay: "media/seed/empress-falls.gpx", mediaType: "application/gpx+xml", filename: "empress-falls.gpx", displayName: "Empress Falls abseils", fileSizeBytes: BigInt(31_000), color: TRACK_COLORS[0], origin: "import", metadata: { bbox: [150.3598, -33.7229, 150.3651, -33.7176], featureCount: 1, positionCount: 214 } },
      { id: seedId("4", 3), ownerId: ALICE_ID, linkedType: "none", linkedId: null, s3KeyDisplay: "media/seed/du-faur.kml", mediaType: "application/vnd.google-earth.kml+xml", filename: "du-faur-approach.kml", displayName: "Du Faur approach", fileSizeBytes: BigInt(21_000), color: TRACK_COLORS[1], origin: "import", metadata: { bbox: [150.3290, -33.5161, 150.3351, -33.5113], featureCount: 3, positionCount: 240 } },
      { id: seedId("4", 4), ownerId: ALICE_ID, linkedType: "none", linkedId: null, s3KeyDisplay: "media/seed/recording-2026-08-02.gpx", mediaType: "application/gpx+xml", filename: "Wollangambe, 2 Aug.gpx", displayName: "Wollangambe, 2 Aug", fileSizeBytes: BigInt(184_000), color: TRACK_COLORS[2], origin: "track", metadata: { bbox: [150.3521, -33.4941, 150.3662, -33.4836], distanceM: 7420, durationMs: 19_800_000, elevationGainM: 265, elevationLossM: 310, pointCount: 6_140, startedAt: "2026-08-02T22:05:00.000Z", endedAt: "2026-08-03T03:35:00.000Z" } },
      // BOB's file on the place he shares with alice. This is the only way a
      // track on someone ELSE's place is reachable in dev, and it is what the
      // Ways page lists beside alice's own files — the case that had no fixture
      // at all, so its column read as permanently empty.
      { id: seedId("4", 5), ownerId: BOB_ID, linkedType: "place", linkedId: BOB_SHARED_PLACE_ID, s3KeyDisplay: "media/seed/coin-slot.gpx", mediaType: "application/gpx+xml", filename: "coin-slot.gpx", displayName: "Coin Slot descent", fileSizeBytes: BigInt(27_000), color: TRACK_COLORS[3], origin: "import", metadata: { bbox: [150.3258, -33.1265, 150.3312, -33.1191], featureCount: 1, positionCount: 180 } },
      // A second recording of alice's, so Tracks is not a single row and the
      // kind rail has something to narrow.
      { id: seedId("4", 6), ownerId: ALICE_ID, linkedType: "none", linkedId: null, s3KeyDisplay: "media/seed/recording-2026-05-17.gpx", mediaType: "application/gpx+xml", filename: "Bell Creek, 17 May.gpx", displayName: "Bell Creek, 17 May", fileSizeBytes: BigInt(96_000), color: TRACK_COLORS[4], origin: "track", metadata: { bbox: [150.3339, -33.5042, 150.3418, -33.4967], distanceM: 4180, durationMs: 12_600_000, elevationGainM: 180, elevationLossM: 240, pointCount: 3_090, startedAt: "2026-05-16T23:40:00.000Z", endedAt: "2026-05-17T03:10:00.000Z" } },
    ],
  });

  // Notifications (payloads are enriched server-side from the referenced ids).
  await prisma.notification.createMany({
    data: [
      { userId: BOB_ID, type: "place_shared", payload: { placeId: PLACE_IDS[0], sharedById: ALICE_ID }, read: false },
      { userId: BOB_ID, type: "place_shared", payload: { placeId: PLACE_IDS[1], sharedById: ALICE_ID }, read: true },
      { userId: ALICE_ID, type: "friend_request", payload: { friendshipId: carolPending.id, requesterUsername: "carol" }, read: false },
    ],
  });

  // Topo jobs are intentionally not seeded: a "complete" job with no S3 tiles
  // behind it renders nothing / breaks the map UI. Submit a real LiDAR ZIP in
  // dev to exercise the topo flow end-to-end instead.

  const placeCount = ALL_PLACES.length;
  console.log(
    `Seed complete: 3 users, ${placeCount} places (1 fork), 5 place shares ` +
      `(1 incoming to alice), 2 direct route shares (1 each way), ` +
      `${trips.length} trip logs, ` +
      `5 marker places, 3 place links, 7 routes, 6 media, 3 notifications, 0 topo jobs`,
  );
}

/**
 * The seven grades are FIELD VALUES now, keyed by the system definitions.
 *
 * The fixture keeps naming them `vGrade` etc. because that is what a canyon
 * has; this is the one place the translation happens, and `setFieldValues`
 * drops the ones that are absent rather than storing nulls — a stored null
 * renders as an empty field and satisfies a "has a value" filter.
 */
function placeCreate(c: SeedPlace): Prisma.PlaceCreateInput {
  const fieldValues = setFieldValues(c.fieldValues ?? {}, {
    v_grade: c.vGrade ?? null,
    a_grade: c.aGrade ?? null,
    commitment: c.commitment ?? null,
    quality: c.quality ?? null,
    hours: c.hours ?? null,
    num_abseils: c.numAbseils ?? null,
    longest_abseil: c.longestAbseil ?? null,
  });
  return {
    id: c.id,
    name: c.name,
    latitude: c.latitude,
    longitude: c.longitude,
    notes: c.notes ?? null,
    altNames: c.altNames ?? [],
    fieldValues: fieldValues as Prisma.InputJsonValue,
    ropeWikiId: c.ropeWikiId ?? null,
    ropeWikiSnapshot: c.ropeWikiSnapshot ?? Prisma.JsonNull,
    owner: { connect: { id: c.ownerId } },
    placeType: {
      connect: { id: c.placeTypeId ?? SYSTEM_PLACE_TYPE_IDS.canyon },
    },
    ...(c.forkedFromId ? { forkedFrom: { connect: { id: c.forkedFromId } } } : {}),
  };
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
