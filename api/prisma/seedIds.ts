// Hand-minted ids for the dev seed. These must be REAL UUIDv4s: version
// nibble 4, variant nibble 8. Mobile's sync push validates every op id with
// isUuidV4 (shared/src/sync.ts) and rejects the WHOLE request on a mismatch,
// so a v0-shaped id here makes every seeded row permanently unsyncable from
// the phone — the local mirror updates, the UI looks right, and the outbox
// row parks blocked with a 400 nothing in the app surfaces.
//
// `prefix` is one hex digit naming the owner/space: "0" users, "1" alice's
// canyons, "2" bob's, "3" carol's, "4" media, "5" custom field definitions.
// Guarded by src/lib/seedIds.unit.test.ts.
export const seedId = (prefix: string, n: number) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const cid = (n: number) => seedId("1", n);
