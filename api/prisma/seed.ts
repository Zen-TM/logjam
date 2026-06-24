import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrlFromEnv } from "../src/lib/databaseUrl";
import { CURRENT_CONSENT_VERSION } from "../src/constants/consent";
import { TRACK_COLORS } from "@logjam/shared";

const adapter = new PrismaPg({ connectionString: databaseUrlFromEnv() });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Rich synthetic seed (operator-trust plan, Part A).
//
// Goal: realistic volume + edge cases so prod data is never needed to develop
// or debug. Canyons are well-published NSW classics (drawn from the public
// canyon list) or deliberately fabricated; ALL trip logs are fabricated.
//
// Test invariants this seed MUST preserve (see api/src/__tests__/_actors.ts):
//   - alice/bob/carol ids + cognito subs (below).
//   - CANYON_IDS[0] === SHARED_CANYON_ID, alice-owned, shared with bob, has >=1
//     trip log. CANYON_IDS[1] also shared with bob. carol is shared NOTHING and
//     is NOT alice's friend (sharing.test.ts asserts a 403 for share->carol).
//   - alice<->bob accepted friendship; carol->alice pending request.
// New data uses fresh ids and never mutates those invariants.
// ---------------------------------------------------------------------------

const ALICE_ID = "00000000-0000-0000-0000-000000000001";
const BOB_ID = "00000000-0000-0000-0000-000000000002";
const CAROL_ID = "00000000-0000-0000-0000-000000000003";

// Matches FAKE_USER_SUB default in auth middleware and the Terraform-generated
// .env.local (infra/terraform/templates/env.local.tftpl)
const ALICE_COGNITO_ID = "fake-alice-sub";
const BOB_COGNITO_ID = "fake-bob-sub";
const CAROL_COGNITO_ID = "fake-carol-sub";

// Stable anchor canyon ids referenced by the integration suite.
const CANYON_IDS = [
  "10000000-0000-0000-0000-000000000001", // SHARED_CANYON_ID (shared w/ bob)
  "10000000-0000-0000-0000-000000000002", // shared w/ bob
  "10000000-0000-0000-0000-000000000003",
  "10000000-0000-0000-0000-000000000004",
  "10000000-0000-0000-0000-000000000005",
];

// Custom-field definitions live on the user's uiPreferences; trip customFields
// JSON is keyed by these `key`s.
const ALICE_TRIP_FIELD_DEFS = [
  { key: "water_level", label: "Water Level", type: "string" },
  { key: "rope_length_m", label: "Rope Length (m)", type: "integer" },
  { key: "wetsuit", label: "Wetsuit", type: "boolean" },
];

type SeedCanyon = {
  id: string;
  ownerId: string;
  name: string;
  latitude: number;
  longitude: number;
  numAbseils?: number;
  longestAbseil?: number;
  vGrade?: number;
  aGrade?: number;
  commitment?: number;
  quality?: number;
  hours?: number;
  notes?: string;
  altNames?: string[];
  attributes?: Prisma.InputJsonValue;
  ropeWikiId?: number;
  ropeWikiSnapshot?: Prisma.InputJsonValue;
  forkedFromId?: string;
};

const cid = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const sandstone = (wetsuit?: number, sources?: [string, string][]): Prisma.InputJsonValue => ({
  rockType: "Sandstone",
  ...(wetsuit != null ? { wetsuit } : {}),
  ...(sources ? { sources } : {}),
});

const ALICE_CANYONS: SeedCanyon[] = [
  // --- anchors (ids referenced by tests) ---
  { id: CANYON_IDS[0], ownerId: ALICE_ID, name: "Grand Canyon", latitude: -33.6563, longitude: 150.3179, numAbseils: 1, longestAbseil: 20, vGrade: 2, aGrade: 2, commitment: 3, quality: 3.4, hours: 3, attributes: sandstone(3) },
  { id: CANYON_IDS[1], ownerId: ALICE_ID, name: "Claustral Canyon", latitude: -33.5603, longitude: 150.4033, numAbseils: 6, longestAbseil: 15, vGrade: 3, aGrade: 3, commitment: 3, quality: 4.9, hours: 9, attributes: sandstone(5) },
  { id: CANYON_IDS[2], ownerId: ALICE_ID, name: "Empress Falls", latitude: -33.72, longitude: 150.3625, numAbseils: 1, longestAbseil: 28, vGrade: 3, aGrade: 2, commitment: 2, quality: 3, hours: 2.5, altNames: ["Valley-of-the-Waters"], attributes: sandstone(4) },
  { id: CANYON_IDS[3], ownerId: ALICE_ID, name: "Hidden Slot", latitude: -33.701, longitude: 150.302, quality: 3, notes: "Fabricated test canyon — not a real location.", attributes: sandstone() },
  { id: CANYON_IDS[4], ownerId: ALICE_ID, name: "Deep Pass", latitude: -33.3396, longitude: 150.3076, numAbseils: 0, vGrade: 1, aGrade: 2, quality: 2, hours: 3, attributes: sandstone(1) },

  // --- more published classics ---
  { id: cid(6), ownerId: ALICE_ID, name: "Butterbox Canyon", latitude: -33.6304, longitude: 150.397, numAbseils: 11, longestAbseil: 20, vGrade: 4, aGrade: 2, commitment: 4, quality: 3.9, hours: 6.5, altNames: ["Mt Hay"], attributes: sandstone(5, [["OzUltimate", "https://ozultimate.com/canyoning/track_notes/mt_hay.htm"]]) },
  { id: cid(7), ownerId: ALICE_ID, name: "Hole-in-the-Wall", latitude: -33.3754, longitude: 150.3292, numAbseils: 5, longestAbseil: 15, vGrade: 2, aGrade: 2, commitment: 3, quality: 4.4, hours: 7, attributes: { rockType: "Limestone", wetsuit: 5 } },
  { id: cid(8), ownerId: ALICE_ID, name: "Fortress Canyon", latitude: -33.6445, longitude: 150.3593, numAbseils: 2, longestAbseil: 6, vGrade: 2, aGrade: 2, quality: 2.5, hours: 6, attributes: sandstone() },
  { id: cid(9), ownerId: ALICE_ID, name: "Whungee Wheengee", latitude: -33.4757, longitude: 150.3742, numAbseils: 7, longestAbseil: 15, vGrade: 2, aGrade: 2, quality: 4, altNames: ["The Green Room"], attributes: sandstone(5) },
  { id: cid(10), ownerId: ALICE_ID, name: "Dione Dell", latitude: -34.0027, longitude: 150.0909, numAbseils: 6, longestAbseil: 25, vGrade: 3, aGrade: 2, commitment: 2, quality: 2.2, hours: 6, altNames: ["Upper Christys Creek"] },
  { id: cid(11), ownerId: ALICE_ID, name: "Tiger Snake Canyon", latitude: -33.2214, longitude: 150.2527, numAbseils: 5, longestAbseil: 25, vGrade: 2, aGrade: 1, commitment: 2, quality: 3.8, hours: 7, altNames: ["Bottleneck"], attributes: sandstone(2) },
  { id: cid(12), ownerId: ALICE_ID, name: "Rocky Creek Canyon", latitude: -33.2878, longitude: 150.2932, numAbseils: 0, vGrade: 1, aGrade: 2, commitment: 2, quality: 4.2, hours: 4.5, attributes: sandstone(5) },
  { id: cid(13), ownerId: ALICE_ID, name: "Twister Canyon", latitude: -33.2876, longitude: 150.2864, numAbseils: 0, vGrade: 2, aGrade: 2, commitment: 2, quality: 3.4, hours: 2, altNames: ["Sheep Dip"], attributes: sandstone(5) },
  // null grades edge case (quality only)
  { id: cid(14), ownerId: ALICE_ID, name: "Wollangambe One", latitude: -33.4888, longitude: 150.3587, numAbseils: 0, quality: 2.5, hours: 7, attributes: sandstone(5) },
  { id: cid(15), ownerId: ALICE_ID, name: "Bell Creek Canyon", latitude: -33.4999, longitude: 150.3371, vGrade: 1, aGrade: 1, commitment: 4, quality: 4.5, hours: 9, attributes: sandstone(5) },
  { id: cid(16), ownerId: ALICE_ID, name: "Arethusa Canyon", latitude: -33.6589, longitude: 150.3467, numAbseils: 6, longestAbseil: 30, vGrade: 4, aGrade: 4, commitment: 3, quality: 4, hours: 9, attributes: sandstone() },
  { id: cid(17), ownerId: ALICE_ID, name: "Starlight Canyon", latitude: -33.1516, longitude: 150.2844, numAbseils: 3, longestAbseil: 25, vGrade: 2, aGrade: 1, quality: 4.5, hours: 9, altNames: ["Newnes", "Wallaby Tunnel"], attributes: sandstone(1) },
  { id: cid(18), ownerId: ALICE_ID, name: "Kanangra Main", latitude: -33.9809, longitude: 150.0991, numAbseils: 17, longestAbseil: 58, vGrade: 4, aGrade: 3, commitment: 5, quality: 4.6, hours: 12, altNames: ["Kanangra Falls"], attributes: { rockType: "Quartzite", wetsuit: 5 } },
  // ropewiki snapshot edge cases
  { id: cid(19), ownerId: ALICE_ID, name: "Yileen Canyon", latitude: -33.5666, longitude: 150.3295, numAbseils: 6, longestAbseil: 50, vGrade: 4, aGrade: 2, commitment: 2, quality: 3, hours: 3.5, ropeWikiId: 90019, ropeWikiSnapshot: { name: "Yileen", region: "Wollemi", quality: 3, rating: "4C2 IV", rappels: 6, longestRappelFt: 164, fetchedAt: "2025-11-02T00:00:00.000Z" }, attributes: { rockType: "Schist", wetsuit: 4, sources: [["RopeWiki", "https://ropewiki.com/Yileen"]] } },
  { id: cid(20), ownerId: ALICE_ID, name: "Serendipity Canyon", latitude: -33.4947, longitude: 150.3812, numAbseils: 6, longestAbseil: 20, vGrade: 2, aGrade: 2, commitment: 3, quality: 3.4, hours: 4, altNames: ["Why Don't We Do It In The Road"], ropeWikiId: 90020, ropeWikiSnapshot: { name: "Serendipity", region: "Blue Mountains", quality: 3, rating: "3C2", rappels: 6, fetchedAt: "2025-11-02T00:00:00.000Z" }, attributes: sandstone(undefined, [["RopeWiki", "https://ropewiki.com/Serendipity"]]) },
  // all-null grades + quality
  { id: cid(21), ownerId: ALICE_ID, name: "Devils Pinch", latitude: -33.1606, longitude: 150.2754, numAbseils: 6, longestAbseil: 30, quality: 4.5, hours: 9, attributes: sandstone(4) },
  { id: cid(22), ownerId: ALICE_ID, name: "Du Faur Creek", latitude: -33.5153, longitude: 150.3343, numAbseils: 0, vGrade: 1, aGrade: 2, commitment: 3, quality: 3.5, hours: 10, altNames: ["Clatterteeth"], attributes: sandstone() },
  { id: cid(23), ownerId: ALICE_ID, name: "Heart Attack Canyon", latitude: -33.2383, longitude: 150.3029, numAbseils: 6, longestAbseil: 37, vGrade: 4, aGrade: 1, commitment: 4, quality: 4, hours: 10, attributes: sandstone(3) },
  { id: cid(24), ownerId: ALICE_ID, name: "Jugglers Canyon", latitude: -33.6592, longitude: 150.3294, numAbseils: 8, longestAbseil: 20, vGrade: 3, aGrade: 1, commitment: 2, quality: 2.3, hours: 4, altNames: ["Pilcher"], attributes: sandstone() },
  { id: cid(25), ownerId: ALICE_ID, name: "Sarcophagus Canyon", latitude: -33.5693, longitude: 150.3235, numAbseils: 7, longestAbseil: 25, vGrade: 3, aGrade: 1, quality: 2.8, hours: 8, ropeWikiId: 90025, ropeWikiSnapshot: { name: "Sarcophagus", region: "Blue Mountains", quality: 2.8, rating: "3C1", rappels: 7, fetchedAt: "2025-11-02T00:00:00.000Z" }, attributes: sandstone() },
  { id: cid(26), ownerId: ALICE_ID, name: "Bowens Creek North (Lower)", latitude: -33.5215, longitude: 150.3932, numAbseils: 3, longestAbseil: 12, vGrade: 2, aGrade: 2, commitment: 3, quality: 3.4, hours: 6, altNames: ["Gobsmacker"], attributes: sandstone(5) },
  { id: cid(27), ownerId: ALICE_ID, name: "Crayfish Creek", latitude: -33.5976, longitude: 150.3037, numAbseils: 0, vGrade: 1, aGrade: 2, quality: 1.5, hours: 7, attributes: sandstone() },
  // second fabricated canyon
  { id: cid(28), ownerId: ALICE_ID, name: "Test Gorge", latitude: -33.55, longitude: 150.28, numAbseils: 2, longestAbseil: 10, quality: 2, notes: "Fabricated canyon for local development.", attributes: sandstone() },
];

// bob owns a fork of alice's shared Grand Canyon + two of his own.
const BOB_CANYONS: SeedCanyon[] = [
  { id: "20000000-0000-0000-0000-000000000001", ownerId: BOB_ID, name: "Grand Canyon (copy)", latitude: -33.6563, longitude: 150.3179, numAbseils: 1, longestAbseil: 20, vGrade: 2, aGrade: 2, commitment: 3, quality: 3.4, hours: 3, forkedFromId: CANYON_IDS[0], attributes: sandstone(3) },
  { id: "20000000-0000-0000-0000-000000000002", ownerId: BOB_ID, name: "Coin Slot", latitude: -33.1224, longitude: 150.3297, numAbseils: 5, longestAbseil: 35, vGrade: 3, aGrade: 1, commitment: 4, quality: 4, hours: 3.5, attributes: sandstone(2) },
  { id: "20000000-0000-0000-0000-000000000003", ownerId: BOB_ID, name: "Galah Canyon", latitude: -33.2514, longitude: 150.3037, numAbseils: 8, longestAbseil: 30, quality: 4, hours: 10, attributes: sandstone(4) },
];

// carol owns her own canyons (and is shared nothing of alice's — the stranger).
const CAROL_CANYONS: SeedCanyon[] = [
  { id: "30000000-0000-0000-0000-000000000001", ownerId: CAROL_ID, name: "Pipeline Canyon", latitude: -33.1658, longitude: 150.2634, numAbseils: 10, longestAbseil: 25, quality: 4, hours: 7, attributes: sandstone(4) },
  { id: "30000000-0000-0000-0000-000000000002", ownerId: CAROL_ID, name: "Surefire Canyon", latitude: -33.2286, longitude: 150.2926, numAbseils: 5, longestAbseil: 15, quality: 4.5, hours: 12, attributes: sandstone(4) },
];

const ALL_CANYONS = [...ALICE_CANYONS, ...BOB_CANYONS, ...CAROL_CANYONS];

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
  canyonId: string | null;
  userId: string;
  date: Date;
  displayName?: string;
  notes: string;
  customFields?: Prisma.InputJsonValue;
};

function buildTrips(): SeedTrip[] {
  const trips: SeedTrip[] = [];
  let seed = 0;

  // alice: 3-4 trips per canyon, with rotating parties/notes and occasional
  // custom fields.
  for (const canyon of ALICE_CANYONS) {
    const count = 3 + (seed % 2); // 3 or 4
    for (let i = 0; i < count; i++) {
      seed++;
      const party = PARTIES[seed % PARTIES.length];
      const withFields = seed % 3 === 0;
      trips.push({
        canyonId: canyon.id,
        userId: ALICE_ID,
        date: tripDate(seed),
        notes: `${NOTE_TEMPLATES[seed % NOTE_TEMPLATES.length]} Party: ${party.join(", ")}.`,
        customFields: withFields
          ? {
              water_level: WATER[seed % WATER.length],
              rope_length_m: String(15 + ((seed * 5) % 50)),
              wetsuit: seed % 2 === 0 ? "true" : "false",
            }
          : undefined,
      });
    }
  }

  // alice: named no-canyon trips (displayName set, canyonId null).
  for (const name of ["Newnes weekend (multi-canyon)", "Kanangra exploratory", "Wollangambe float", "Rescue practice day"]) {
    seed++;
    trips.push({
      canyonId: null,
      userId: ALICE_ID,
      date: tripDate(seed),
      displayName: name,
      notes: `${NOTE_TEMPLATES[seed % NOTE_TEMPLATES.length]} (No single canyon — logged by name.)`,
    });
  }

  // bob: trips on his own canyons + one named no-canyon trip.
  for (const canyon of BOB_CANYONS) {
    for (let i = 0; i < 3; i++) {
      seed++;
      trips.push({
        canyonId: canyon.id,
        userId: BOB_ID,
        date: tripDate(seed),
        notes: `${NOTE_TEMPLATES[seed % NOTE_TEMPLATES.length]} Party: ${PARTIES[seed % PARTIES.length].join(", ")}.`,
      });
    }
  }
  seed++;
  trips.push({ canyonId: null, userId: BOB_ID, date: tripDate(seed), displayName: "Canyoning festival 2024", notes: "Three canyons in a day. Logged as one entry." });

  // carol: trips on her own canyons.
  for (const canyon of CAROL_CANYONS) {
    for (let i = 0; i < 3; i++) {
      seed++;
      trips.push({
        canyonId: canyon.id,
        userId: CAROL_ID,
        date: tripDate(seed),
        notes: `${NOTE_TEMPLATES[seed % NOTE_TEMPLATES.length]} Party: ${PARTIES[seed % PARTIES.length].join(", ")}.`,
      });
    }
  }

  return trips;
}

async function main() {
  // Delete in reverse FK dependency order (Postgres enforces constraints per statement)
  await prisma.$transaction([
    prisma.canyonShare.deleteMany(),
    prisma.friendship.deleteMany(),
    prisma.media.deleteMany(),
    prisma.tripLog.deleteMany(),
    prisma.canyon.deleteMany(),
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
        uiPreferences: {
          tripLogCustomFields: ALICE_TRIP_FIELD_DEFS,
          autoDownloadGeoPdfs: false,
        },
      },
      { id: BOB_ID, cognitoId: BOB_COGNITO_ID, username: "bob", email: "bob@local", consentedAt, consentVersion: CURRENT_CONSENT_VERSION },
      { id: CAROL_ID, cognitoId: CAROL_COGNITO_ID, username: "carol", email: "carol@local", consentedAt, consentVersion: CURRENT_CONSENT_VERSION },
    ],
  });

  // Friendships: alice<->bob accepted (invariant), carol->alice pending
  // (invariant), bob<->carol accepted (extra graph; does NOT make carol alice's
  // friend, so the share->carol 403 test still holds).
  await prisma.friendship.create({ data: { requesterId: ALICE_ID, addresseeId: BOB_ID, status: "accepted" } });
  const carolPending = await prisma.friendship.create({ data: { requesterId: CAROL_ID, addresseeId: ALICE_ID, status: "pending" } });
  await prisma.friendship.create({ data: { requesterId: BOB_ID, addresseeId: CAROL_ID, status: "accepted" } });

  // Canyons. Forks reference an existing id, so insert non-forks first.
  for (const c of ALL_CANYONS.filter((c) => !c.forkedFromId)) {
    await prisma.canyon.create({ data: canyonCreate(c) });
  }
  for (const c of ALL_CANYONS.filter((c) => c.forkedFromId)) {
    await prisma.canyon.create({ data: canyonCreate(c) });
  }

  // Shares: anchors 0 & 1 (invariant) + two more, all alice->bob. carol gets none.
  await prisma.canyonShare.createMany({
    data: [CANYON_IDS[0], CANYON_IDS[1], cid(6), cid(9)].map((canyonId) => ({
      canyonId,
      sharedById: ALICE_ID,
      sharedWithId: BOB_ID,
    })),
  });

  // Trip logs.
  const trips = buildTrips();
  for (const t of trips) {
    await prisma.tripLog.create({
      data: {
        canyonId: t.canyonId,
        userId: t.userId,
        date: t.date,
        displayName: t.displayName,
        notes: t.notes,
        ...(t.customFields ? { customFields: t.customFields } : {}),
      },
    });
  }

  // Media (metadata only — no S3 objects exist locally, so thumbnails won't
  // load; the rows exist to populate media-list code paths).
  await prisma.media.createMany({
    data: [
      { ownerId: ALICE_ID, linkedType: "canyon", linkedId: CANYON_IDS[0], s3KeyDisplay: "media/seed/grand-1.jpg", s3KeyThumbnail: "media/seed/grand-1-thumb.jpg", mediaType: "image/jpeg", filename: "grand-canyon.jpg", fileSizeBytes: BigInt(2_048_000) },
      { ownerId: ALICE_ID, linkedType: "canyon", linkedId: CANYON_IDS[1], s3KeyDisplay: "media/seed/claustral.gpx", mediaType: "application/gpx+xml", filename: "claustral-track.gpx", fileSizeBytes: BigInt(48_000), color: TRACK_COLORS[0] },
    ],
  });

  // Notifications (payloads are enriched server-side from the referenced ids).
  await prisma.notification.createMany({
    data: [
      { userId: BOB_ID, type: "canyon_shared", payload: { canyonId: CANYON_IDS[0], sharedById: ALICE_ID }, read: false },
      { userId: BOB_ID, type: "canyon_shared", payload: { canyonId: CANYON_IDS[1], sharedById: ALICE_ID }, read: true },
      { userId: ALICE_ID, type: "friend_request", payload: { friendshipId: carolPending.id, requesterUsername: "carol" }, read: false },
    ],
  });

  // Topo jobs: one complete, one failed (exercises job-list + reaper UI; no S3
  // tiles back them).
  await prisma.topoJob.createMany({
    data: [
      {
        userId: ALICE_ID,
        status: "complete",
        name: "Grose Valley LiDAR",
        footprint: { type: "Polygon", coordinates: [[[150.30, -33.66], [150.35, -33.66], [150.35, -33.62], [150.30, -33.62], [150.30, -33.66]]] },
        tileCount: 1240,
        outputBytes: BigInt(524_288_000),
        startedAt: new Date("2026-02-10T01:00:00.000Z"),
        attemptCount: 1,
      },
      {
        userId: ALICE_ID,
        status: "failed",
        name: "Kanangra test render",
        errorMessage: "Worker placement failed (no Fargate capacity).",
        attemptCount: 1,
      },
    ],
  });

  const canyonCount = ALL_CANYONS.length;
  console.log(
    `Seed complete: 3 users, ${canyonCount} canyons (1 fork), 4 shares, ${trips.length} trip logs, 2 media, 3 notifications, 2 topo jobs`,
  );
}

function canyonCreate(c: SeedCanyon): Prisma.CanyonCreateInput {
  return {
    id: c.id,
    name: c.name,
    latitude: c.latitude,
    longitude: c.longitude,
    numAbseils: c.numAbseils ?? null,
    longestAbseil: c.longestAbseil ?? null,
    vGrade: c.vGrade ?? null,
    aGrade: c.aGrade ?? null,
    commitment: c.commitment ?? null,
    quality: c.quality ?? null,
    hours: c.hours ?? null,
    notes: c.notes ?? null,
    altNames: c.altNames ?? [],
    attributes: c.attributes ?? {},
    ropeWikiId: c.ropeWikiId ?? null,
    ropeWikiSnapshot: c.ropeWikiSnapshot ?? Prisma.JsonNull,
    owner: { connect: { id: c.ownerId } },
    ...(c.forkedFromId ? { forkedFrom: { connect: { id: c.forkedFromId } } } : {}),
  };
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
