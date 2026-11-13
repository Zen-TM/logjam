// Hand-minted ids for the dev seed. These must be REAL UUIDv4s: version
// nibble 4, variant nibble 8. Mobile's sync push validates every op id with
// isUuidV4 (shared/src/sync.ts) and rejects the WHOLE request on a mismatch,
// so a v0-shaped id here makes every seeded row permanently unsyncable from
// the phone — the local mirror updates, the UI looks right, and the outbox
// row parks blocked with a 400 nothing in the app surfaces.
//
// `prefix` is one hex digit naming the owner/space: "0" users, "1" alice's
// places (and from 200 up, the edge users' own), "2" bob's, "3" carol's, "4" media, "5" custom field definitions,
// "6" marker places and the links between places (the waypoint space —
// waypoint ids are preserved as place ids), "7" routes, "8" direct (per-item)
// shares, "9" user-created place types, "c" trip logs, "d" friendships, "e"
// place shares, "f" jobs, templates, sends and invites (the
// rows an account's background work and its inbox leave behind).
//
// "a" and "b" are NOT here and MUST NOT BE: they are the SYSTEM field
// definitions' and SYSTEM place types' prefixes, pinned in
// shared/src/placeTypes.ts because the forward migration mints them too.
// Guard: src/lib/seedIds.unit.test.ts asserts the two id spaces cannot overlap.
// SEED_ID_PREFIXES below is the declaration; src/lib/seedIds.unit.test.ts
// iterates it, so a prefix used here without joining the list fails the guard.
export const seedId = (prefix: string, n: number) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const cid = (n: number) => seedId("1", n);

// The rows tests and specs name by id. One declaration, imported by the seed
// and by src/__tests__/_actors.ts, so the two cannot disagree; a unit test
// (src/lib/seedIds.unit.test.ts) holds that the seed uses every one.
export const ALICE_ID = seedId("0", 1);
export const BOB_ID = seedId("0", 2);
export const CAROL_ID = seedId("0", 3);
/** Alice's place shared with bob. */
export const SHARED_PLACE_ID = cid(1);
/** Bob's "Coin Slot" place, shared with alice. */
export const BOB_SHARED_PLACE_ID = seedId("2", 2);
/** Bob's own Marker place, shared with nobody; the "6" space is the waypoint
 *  space (waypoint ids are preserved as place ids). */
export const BOB_MARKER_PLACE_ID = seedId("6", 5);
/** Bob's route, directly shared with alice. */
export const BOB_SHARED_ROUTE_ID = seedId("7", 3);
/** Bob's complete topo job, directly shared with alice. */
export const BOB_SHARED_TOPO_JOB_ID = seedId("f", 4);
/** The seed's plan (alice leads, bob is a member, carol asked to join) and the
 *  place and route it owns, which belong to no user. */
export const SEED_PLAN_ID = seedId("f", 100);
export const PLAN_PLACE_ID = seedId("6", 100);
export const PLAN_ROUTE_ID = seedId("7", 100);
/** Carol's plan, which she has invited alice to by username. */
export const CAROL_PLAN_ID = seedId("f", 110);

/** Accounts that each hold a state the three main users cannot: no data, no
 *  consent, a consent from before the current text, a full quota, awkward text,
 *  work in flight, a plan led and a plan edited. None is a friend of alice, bob
 *  or carol, so nothing the suites assert about the friend graph or sharing
 *  sees them. prisma/seedStates.ts names what each holds. */
export const SEED_EDGE_USERS = {
  empty: seedId("0", 4),
  unconsented: seedId("0", 5),
  staleConsent: seedId("0", 6),
  atQuota: seedId("0", 7),
  awkwardText: seedId("0", 8),
  topoInFlight: seedId("0", 9),
  planLeader: seedId("0", 10),
  planEditor: seedId("0", 11),
} as const;

/** Every prefix the seed mints under — the list the guard test iterates. */
export const SEED_ID_PREFIXES = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "c",
  "d",
  "e",
  "f",
] as const;
