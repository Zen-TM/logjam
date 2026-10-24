import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrlFromEnv } from "../src/lib/databaseUrl";
import { CURRENT_CONSENT_VERSION } from "../src/constants/consent";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  hashFriendInviteToken,
  mintFriendInviteToken,
} from "../src/lib/friendInviteToken";
import {
  GEO_PDF_FAILURE_MESSAGE,
  TOPO_EXPORT_STOPPED_MESSAGE,
  TOPO_UNREADABLE_MESSAGE,
} from "../src/lib/failureCopy";
import {
  NOTIFICATION_TYPES,
  FILE_SEND_TTL_DAYS,
  FRIEND_INVITE_TTL_DAYS,
  RASTER_TEMPLATE_DEFAULTS,
  VECTOR_STYLE_DEFAULTS,
  validateGeoPdfConfig,
  validateGeoPdfTemplateConfig,
  validateRasterTemplateSettings,
  type GeoPdfConfig,
  enforceCanyoningTag,
  linksCanyon,
  friendInviteUrl,
  isFriendInviteToken,
  setFieldValues,
  routeLengthM,
  routeToGpx,
  routeToKml,
  SOURCES_FIELD_KEY,
  SYSTEM_FIELD_DEFS,
  PLACE_TYPE_COLORS,
  canonicalLinkPair,
  PLACE_REGISTRY_POINTER_PATH,
  PLACE_REGISTRY_PREFIX,
  SYSTEM_PLACE_TYPE_IDS,
  SYSTEM_PLACE_TYPES,
  TRACK_COLORS,
  trackPointsToGpx,
} from "@logjam/shared";
import { s3 } from "../src/services/awsClients";
import { seedId, cid } from "./seedIds";
import {
  flatPng,
  lineVectorTile,
  singleTilePmtiles,
  tileAt,
  tileBounds,
} from "./seedArchives";
import { saveSeedSnapshot } from "../src/__tests__/_seedBaseline";

// ── Place registry ──────────────────────────────────────────────────────────

/**
 * Publishes the shared fixture as the place registry, where the builder would
 * (topo/build_place_registry.py), so a dev stack answers location search with
 * no build of its own (services/placeRegistry.ts). Best effort, as the files
 * below are.
 */
async function uploadPlaceRegistry(): Promise<void> {
  const bucket = process.env.S3_BUCKET_TOPO;
  if (!bucket) {
    console.warn("S3_BUCKET_TOPO is unset — no place registry was uploaded.");
    return;
  }
  const fixture = readFileSync(
    join(__dirname, "../../shared/src/__fixtures__/place-registry.json"),
  );
  const { format, version } = JSON.parse(fixture.toString("utf8"));
  const body = gzipSync(fixture);
  // Named and served as the builder publishes a build: the version and a
  // content hash, gzipped under a .json name with Content-Encoding.
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 8);
  const path = `places-${version}-${hash}.json`;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${PLACE_REGISTRY_PREFIX}${path}`,
        Body: body,
        ContentType: "application/json",
        ContentEncoding: "gzip",
      }),
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: PLACE_REGISTRY_POINTER_PATH,
        Body: JSON.stringify({ format, version, path, bytes: body.length }),
        ContentType: "application/json",
      }),
    );
    console.log(`Uploaded the fixture place registry to s3://${bucket}/`);
  } catch (err) {
    console.warn(
      `Could not upload the place registry (${(err as Error).message}). Location search will answer 503.`,
    );
  }
}

// ── Seeded vector files ─────────────────────────────────────────────────────
//
// Every vector file row has a real S3 object behind it: a row with nothing in
// S3 behind it is data no client can produce.
//
// Every figure a row states is DERIVED from the bytes actually uploaded —
// extent, point count, length, size — so a row cannot contradict its own file.

/**
 * When the two seeded recordings ran: stated once, for the row and the file.
 * Short on purpose. Both lines are about a kilometre, and a longer span is a
 * pace under `MOVING_SPEED_THRESHOLD_MPS`, which the stats engine reads as
 * standing still: the speed chart would be a flat zero.
 */
const WOLLANGAMBE_RECORDED = {
  startedAt: "2026-08-02T22:05:00.000Z",
  endedAt: "2026-08-02T22:30:00.000Z",
};
const BELL_CREEK_RECORDED = {
  startedAt: "2026-05-16T23:40:00.000Z",
  endedAt: "2026-05-17T00:05:00.000Z",
};

type SeededFile = {
  key: string;
  body: string;
  contentType: string;
  fileSizeBytes: number;
  bbox: [number, number, number, number];
  positionCount: number;
  distanceM: number;
};

function seededFile(
  key: string,
  name: string,
  line: [number, number][],
  format: "gpx" | "kml",
  /**
   * Set for a RECORDING: the file is written the way Logjam GPS writes one,
   * with a time and a height on every fix spread evenly over this span, so its
   * page has a speed and an elevation profile to draw. The heights are made up.
   */
  recorded?: { startedAt: string; endedAt: string },
): SeededFile {
  const startMs = recorded ? Date.parse(recorded.startedAt) : 0;
  const stepMs = recorded
    ? (Date.parse(recorded.endedAt) - startMs) / (line.length - 1)
    : 0;
  const body = recorded
    ? trackPointsToGpx(
        name,
        line.map(([lon, lat], i) => ({
          lon,
          lat,
          altitudeM: 640 + 45 * Math.sin(i / 3),
          accuracyM: 5,
          timestampMs: Math.round(startMs + i * stepMs),
          segment: 0,
        })),
      )
    : format === "gpx"
      ? routeToGpx(name, line)
      : routeToKml(name, line);
  const lons = line.map(([lon]) => lon);
  const lats = line.map(([, lat]) => lat);
  return {
    key,
    body,
    contentType:
      format === "gpx"
        ? "application/gpx+xml"
        : "application/vnd.google-earth.kml+xml",
    fileSizeBytes: Buffer.byteLength(body, "utf8"),
    bbox: [
      Math.min(...lons),
      Math.min(...lats),
      Math.max(...lons),
      Math.max(...lats),
    ],
    positionCount: line.length,
    distanceM: Math.round(routeLengthM(line)),
  };
}

/**
 * Puts the seeded files where their rows say they are.
 *
 * BEST EFFORT on purpose: a box brought up with `docker compose up postgres
 * ministack` skips `make _ministack-tf`, so no bucket exists (CLAUDE.local.md).
 * Failing the seed over that would block every other fixture for the sake of
 * five small files, so this warns and leaves the rows.
 */
async function uploadSeededFiles(files: SeededFile[]): Promise<void> {
  const bucket = process.env.S3_BUCKET_MEDIA;
  if (!bucket) {
    console.warn(
      "S3_BUCKET_MEDIA is unset — seeded track files were not uploaded.",
    );
    return;
  }
  try {
    for (const file of files) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: file.key,
          Body: file.body,
          ContentType: file.contentType,
        }),
      );
    }
    console.log(
      `Uploaded ${files.length} seeded track files to s3://${bucket}/media/seed/`,
    );
  } catch (err) {
    console.warn(
      `Could not upload seeded track files (${(err as Error).message}). The rows still exist; their pages will report a file that isn't there.`,
    );
  }
}

const adapter = new PrismaPg({ connectionString: databaseUrlFromEnv() });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Rich synthetic seed.
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

// Custom-field definitions are ROWS in `custom_field_defs`; trip customFields
// JSON is keyed by these `key`s. Ids come from seedId like every other seeded
// row — the sync push path validates op ids with isUuidV4 and rejects the whole
// request on a mismatch, so a hand-written id here would make alice's
// definitions permanently unsyncable from the phone.
/** Marker-place and route ids — prefixes "6" and "7" (prisma/seedIds.ts). The
 * "6" space is the waypoint space: waypoint ids are preserved as place ids, so
 * the seed does too. */
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
// its name.
const CLAUSTRAL_LINE: [number, number][] = [
  [150.4033, -33.5603],
  [150.4041, -33.5611],
  [150.4052, -33.562],
  [150.4066, -33.5629],
  [150.4078, -33.5641],
  [150.4089, -33.5653],
  [150.4097, -33.5666],
  [150.4101, -33.568],
  [150.4098, -33.5694],
  [150.4089, -33.5707],
];

const DU_FAUR_LINE: [number, number][] = [
  [150.3298, -33.5121],
  [150.331, -33.5128],
  [150.3322, -33.5136],
  [150.3334, -33.5145],
  [150.3343, -33.5153],
  [150.3351, -33.5162],
];

const COIN_SLOT_LINE: [number, number][] = [
  [150.3271, -33.1198],
  [150.3282, -33.1207],
  [150.329, -33.1216],
  [150.3297, -33.1224],
  [150.3303, -33.1233],
  [150.3308, -33.1243],
];

// Bob's descent takes over exactly where his approach stops, rather than being
// the same polyline twice: the place holds the descent FILE and the approach
// route is unlinked, so a reader who opens both must see two different lines.
const COIN_SLOT_DESCENT_LINE: [number, number][] = [
  [150.3308, -33.1243],
  [150.3312, -33.1252],
  [150.3313, -33.1262],
  [150.331, -33.1271],
  [150.3304, -33.1279],
  [150.3296, -33.1285],
];

const EMPRESS_FALLS_LINE: [number, number][] = [
  [150.3625, -33.72],
  [150.3631, -33.7209],
  [150.3634, -33.7219],
  [150.3633, -33.7229],
  [150.3628, -33.7238],
  [150.362, -33.7245],
];

const BELL_CREEK_LINE: [number, number][] = [
  [150.3345, -33.4972],
  [150.3358, -33.4983],
  [150.3371, -33.4995],
  [150.3384, -33.5008],
  [150.3396, -33.5021],
  [150.3407, -33.5034],
  [150.3415, -33.5048],
];

const BUTTERBOX_LINE: [number, number][] = [
  [150.397, -33.6304],
  [150.3979, -33.6313],
  [150.3986, -33.6324],
  [150.3991, -33.6336],
  [150.3993, -33.6349],
  [150.399, -33.6362],
];

const GRAND_CANYON_LINE: [number, number][] = [
  [150.3179, -33.6563],
  [150.3188, -33.6572],
  [150.3199, -33.658],
  [150.3212, -33.6586],
  [150.3226, -33.659],
  [150.3241, -33.6591],
  [150.3255, -33.6588],
];

const WOLLANGAMBE_LINE: [number, number][] = [
  [150.3587, -33.4888],
  [150.3601, -33.4896],
  [150.3617, -33.4903],
  [150.3634, -33.4908],
  [150.3652, -33.4911],
  [150.367, -33.4912],
  [150.3688, -33.491],
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
// and a trip-log definition has no type picker to answer the question with.
//
// `rope_length_m` is scoped to the `canyoning` TRIP TYPE rather than to every
// trip, so dev has an attribute that appears and disappears as a trip's tags
// change — the case the trip form and the stats drill-down both have to get
// right, and one nobody can try without a scoped definition existing.
const ALICE_TRIP_FIELD_DEFS = [
  {
    key: "water_level",
    label: "Water Level",
    type: "string",
    appliesToAllTypes: true,
    tripTypes: [] as string[],
  },
  {
    key: "rope_length_m",
    label: "Rope Length (m)",
    type: "integer",
    appliesToAllTypes: false,
    tripTypes: ["canyoning"],
  },
  {
    key: "wetsuit",
    label: "Wetsuit",
    type: "boolean",
    appliesToAllTypes: true,
    tripTypes: [] as string[],
  },
];

// A place type ALICE made herself, so copy reconciliation is exercisable in
// dev: bob receiving a copy of one of these has to match it by NAME against his
// own types, and there is no way to try that without a user type existing.
const ALICE_TYPE_ID = seedId("9", 1);

// Place-scoped definitions alice owns. `access_beta` is scoped to her own type;
// `permit_no` is `appliesToAllTypes`, which is the flag a new type inherits for
// free — the case join rows cannot express.
//
// NONE of these may use a reserved key: `assertKeyNotReserved` refuses them on
// the API path (src/__tests__/placeTypes.test.ts), and the seed writing one
// directly would create the exact two-writers-one-key state the reservation
// exists to prevent.
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
  // The other value types a definition can have (string is `permit_no`), so a
  // form, a filter and a sync round trip each meet every type in dev. The
  // system fields add integer, float and boolean on the campsite type.
  {
    id: seedId("5", 12),
    key: "water_temp_c",
    label: "Water temperature (°C)",
    type: "float",
    placeTypeIds: [] as string[],
    appliesToAllTypes: true,
  },
  {
    id: seedId("5", 13),
    key: "last_checked",
    label: "Last checked",
    type: "date",
    placeTypeIds: [] as string[],
    appliesToAllTypes: true,
  },
  {
    id: seedId("5", 14),
    key: "rope_count",
    label: "Ropes needed",
    type: "integer",
    placeTypeIds: [] as string[],
    appliesToAllTypes: true,
  },
  {
    id: seedId("5", 15),
    key: "needs_permit",
    label: "Needs a permit",
    type: "boolean",
    placeTypeIds: [] as string[],
    appliesToAllTypes: true,
  },
];

// Types bob and carol made themselves, so the user-type paths are reachable
// as each of them and not only as alice.
const BOB_TYPE_ID = seedId("9", 2);
const CAROL_TYPE_ID = seedId("9", 3);

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

// `sources()` stores entries under the reserved `_sources` key.
const sources = (...entries: [string, string][]): Record<string, unknown> => ({
  [SOURCES_FIELD_KEY]: entries,
});

const ALICE_PLACES: SeedPlace[] = [
  // --- anchors (ids referenced by tests) ---
  {
    id: PLACE_IDS[0],
    ownerId: ALICE_ID,
    name: "Grand Canyon",
    latitude: -33.6563,
    longitude: 150.3179,
    numAbseils: 1,
    longestAbseil: 20,
    vGrade: 2,
    aGrade: 2,
    commitment: 3,
    quality: 3.4,
    hours: 3,
    fieldValues: {},
  },
  {
    id: PLACE_IDS[1],
    ownerId: ALICE_ID,
    name: "Claustral Canyon",
    latitude: -33.5603,
    longitude: 150.4033,
    numAbseils: 6,
    longestAbseil: 15,
    vGrade: 3,
    aGrade: 3,
    commitment: 3,
    quality: 4.9,
    hours: 9,
    fieldValues: {},
  },
  {
    id: PLACE_IDS[2],
    ownerId: ALICE_ID,
    name: "Empress Falls",
    latitude: -33.72,
    longitude: 150.3625,
    numAbseils: 1,
    longestAbseil: 28,
    vGrade: 3,
    aGrade: 2,
    commitment: 2,
    quality: 3,
    hours: 2.5,
    altNames: ["Valley-of-the-Waters"],
    fieldValues: {},
  },
  {
    id: PLACE_IDS[3],
    ownerId: ALICE_ID,
    name: "Hidden Slot",
    latitude: -33.701,
    longitude: 150.302,
    quality: 3,
    notes: "Fabricated test place — not a real location.",
    fieldValues: {},
  },
  {
    id: PLACE_IDS[4],
    ownerId: ALICE_ID,
    name: "Deep Pass",
    latitude: -33.3396,
    longitude: 150.3076,
    numAbseils: 0,
    vGrade: 1,
    aGrade: 2,
    quality: 2,
    hours: 3,
    fieldValues: {},
  },

  // --- more published classics ---
  {
    id: cid(6),
    ownerId: ALICE_ID,
    name: "Butterbox Canyon",
    latitude: -33.6304,
    longitude: 150.397,
    numAbseils: 11,
    longestAbseil: 20,
    vGrade: 4,
    aGrade: 2,
    commitment: 4,
    quality: 3.9,
    hours: 6.5,
    altNames: ["Mt Hay"],
    fieldValues: sources([
      "OzUltimate",
      "https://ozultimate.com/canyoning/track_notes/mt_hay.htm",
    ]),
  },
  {
    id: cid(7),
    ownerId: ALICE_ID,
    name: "Hole-in-the-Wall",
    latitude: -33.3754,
    longitude: 150.3292,
    numAbseils: 5,
    longestAbseil: 15,
    vGrade: 2,
    aGrade: 2,
    commitment: 3,
    quality: 4.4,
    hours: 7,
    fieldValues: {},
  },
  {
    id: cid(8),
    ownerId: ALICE_ID,
    name: "Fortress Canyon",
    latitude: -33.6445,
    longitude: 150.3593,
    numAbseils: 2,
    longestAbseil: 6,
    vGrade: 2,
    aGrade: 2,
    quality: 2.5,
    hours: 6,
    fieldValues: {},
  },
  {
    id: cid(9),
    ownerId: ALICE_ID,
    name: "Whungee Wheengee",
    latitude: -33.4757,
    longitude: 150.3742,
    numAbseils: 7,
    longestAbseil: 15,
    vGrade: 2,
    aGrade: 2,
    quality: 4,
    altNames: ["The Green Room"],
    fieldValues: {},
  },
  {
    id: cid(10),
    ownerId: ALICE_ID,
    name: "Dione Dell",
    latitude: -34.0027,
    longitude: 150.0909,
    numAbseils: 6,
    longestAbseil: 25,
    vGrade: 3,
    aGrade: 2,
    commitment: 2,
    quality: 2.2,
    hours: 6,
    altNames: ["Upper Christys Creek"],
  },
  {
    id: cid(11),
    ownerId: ALICE_ID,
    name: "Tiger Snake Canyon",
    latitude: -33.2214,
    longitude: 150.2527,
    numAbseils: 5,
    longestAbseil: 25,
    vGrade: 2,
    aGrade: 1,
    commitment: 2,
    quality: 3.8,
    hours: 7,
    altNames: ["Bottleneck"],
    fieldValues: {},
  },
  {
    id: cid(12),
    ownerId: ALICE_ID,
    name: "Rocky Creek Canyon",
    latitude: -33.2878,
    longitude: 150.2932,
    numAbseils: 0,
    vGrade: 1,
    aGrade: 2,
    commitment: 2,
    quality: 4.2,
    hours: 4.5,
    fieldValues: {},
  },
  {
    id: cid(13),
    ownerId: ALICE_ID,
    name: "Twister Canyon",
    latitude: -33.2876,
    longitude: 150.2864,
    numAbseils: 0,
    vGrade: 2,
    aGrade: 2,
    commitment: 2,
    quality: 3.4,
    hours: 2,
    altNames: ["Sheep Dip"],
    fieldValues: {},
  },
  // null grades edge case (quality only)
  {
    id: cid(14),
    ownerId: ALICE_ID,
    name: "Wollangambe One",
    latitude: -33.4888,
    longitude: 150.3587,
    numAbseils: 0,
    quality: 2.5,
    hours: 7,
    fieldValues: {},
  },
  {
    id: cid(15),
    ownerId: ALICE_ID,
    name: "Bell Creek Canyon",
    latitude: -33.4999,
    longitude: 150.3371,
    vGrade: 1,
    aGrade: 1,
    commitment: 4,
    quality: 4.5,
    hours: 9,
    fieldValues: {},
  },
  {
    id: cid(16),
    ownerId: ALICE_ID,
    name: "Arethusa Canyon",
    latitude: -33.6589,
    longitude: 150.3467,
    numAbseils: 6,
    longestAbseil: 30,
    vGrade: 4,
    aGrade: 4,
    commitment: 3,
    quality: 4,
    hours: 9,
    fieldValues: {},
  },
  {
    id: cid(17),
    ownerId: ALICE_ID,
    name: "Starlight Canyon",
    latitude: -33.1516,
    longitude: 150.2844,
    numAbseils: 3,
    longestAbseil: 25,
    vGrade: 2,
    aGrade: 1,
    quality: 4.5,
    hours: 9,
    altNames: ["Newnes", "Wallaby Tunnel"],
    fieldValues: {},
  },
  {
    id: cid(18),
    ownerId: ALICE_ID,
    name: "Kanangra Main",
    latitude: -33.9809,
    longitude: 150.0991,
    numAbseils: 17,
    longestAbseil: 58,
    vGrade: 4,
    aGrade: 3,
    commitment: 5,
    quality: 4.6,
    hours: 12,
    altNames: ["Kanangra Falls"],
    fieldValues: {},
  },
  // ropewiki snapshot edge cases
  {
    id: cid(19),
    ownerId: ALICE_ID,
    name: "Yileen Canyon",
    latitude: -33.5666,
    longitude: 150.3295,
    numAbseils: 6,
    longestAbseil: 50,
    vGrade: 4,
    aGrade: 2,
    commitment: 2,
    quality: 3,
    hours: 3.5,
    ropeWikiId: 90019,
    ropeWikiSnapshot: {
      name: "Yileen",
      region: "Wollemi",
      quality: 3,
      rating: "4C2 IV",
      rappels: 6,
      longestRappelFt: 164,
      fetchedAt: "2025-11-02T00:00:00.000Z",
    },
    fieldValues: sources(["RopeWiki", "https://ropewiki.com/Yileen"]),
  },
  {
    id: cid(20),
    ownerId: ALICE_ID,
    name: "Serendipity Canyon",
    latitude: -33.4947,
    longitude: 150.3812,
    numAbseils: 6,
    longestAbseil: 20,
    vGrade: 2,
    aGrade: 2,
    commitment: 3,
    quality: 3.4,
    hours: 4,
    altNames: ["Why Don't We Do It In The Road"],
    ropeWikiId: 90020,
    ropeWikiSnapshot: {
      name: "Serendipity",
      region: "Blue Mountains",
      quality: 3,
      rating: "3C2",
      rappels: 6,
      fetchedAt: "2025-11-02T00:00:00.000Z",
    },
    fieldValues: sources(["RopeWiki", "https://ropewiki.com/Serendipity"]),
  },
  // all-null grades + quality
  {
    id: cid(21),
    ownerId: ALICE_ID,
    name: "Devils Pinch",
    latitude: -33.1606,
    longitude: 150.2754,
    numAbseils: 6,
    longestAbseil: 30,
    quality: 4.5,
    hours: 9,
    fieldValues: {},
  },
  {
    id: cid(22),
    ownerId: ALICE_ID,
    name: "Du Faur Creek",
    latitude: -33.5153,
    longitude: 150.3343,
    numAbseils: 0,
    vGrade: 1,
    aGrade: 2,
    commitment: 3,
    quality: 3.5,
    hours: 10,
    altNames: ["Clatterteeth"],
    fieldValues: {},
  },
  {
    id: cid(23),
    ownerId: ALICE_ID,
    name: "Heart Attack Canyon",
    latitude: -33.2383,
    longitude: 150.3029,
    numAbseils: 6,
    longestAbseil: 37,
    vGrade: 4,
    aGrade: 1,
    commitment: 4,
    quality: 4,
    hours: 10,
    fieldValues: {},
  },
  {
    id: cid(24),
    ownerId: ALICE_ID,
    name: "Jugglers Canyon",
    latitude: -33.6592,
    longitude: 150.3294,
    numAbseils: 8,
    longestAbseil: 20,
    vGrade: 3,
    aGrade: 1,
    commitment: 2,
    quality: 2.3,
    hours: 4,
    altNames: ["Pilcher"],
    fieldValues: {},
  },
  {
    id: cid(25),
    ownerId: ALICE_ID,
    name: "Sarcophagus Canyon",
    latitude: -33.5693,
    longitude: 150.3235,
    numAbseils: 7,
    longestAbseil: 25,
    vGrade: 3,
    aGrade: 1,
    quality: 2.8,
    hours: 8,
    ropeWikiId: 90025,
    ropeWikiSnapshot: {
      name: "Sarcophagus",
      region: "Blue Mountains",
      quality: 2.8,
      rating: "3C1",
      rappels: 7,
      fetchedAt: "2025-11-02T00:00:00.000Z",
    },
    fieldValues: {},
  },
  {
    id: cid(26),
    ownerId: ALICE_ID,
    name: "Bowens Creek North (Lower)",
    latitude: -33.5215,
    longitude: 150.3932,
    numAbseils: 3,
    longestAbseil: 12,
    vGrade: 2,
    aGrade: 2,
    commitment: 3,
    quality: 3.4,
    hours: 6,
    altNames: ["Gobsmacker"],
    fieldValues: {},
  },
  {
    id: cid(27),
    ownerId: ALICE_ID,
    name: "Crayfish Creek",
    latitude: -33.5976,
    longitude: 150.3037,
    numAbseils: 0,
    vGrade: 1,
    aGrade: 2,
    quality: 1.5,
    hours: 7,
    fieldValues: {},
  },
  // second fabricated place
  {
    id: cid(28),
    ownerId: ALICE_ID,
    name: "Test Gorge",
    latitude: -33.55,
    longitude: 150.28,
    numAbseils: 2,
    longestAbseil: 10,
    quality: 2,
    notes: "Fabricated place for local development.",
    fieldValues: {},
  },

  // ── the field machinery, made visible in dev ─────────────────────────────
  //
  // These three make each case reachable in dev:
  //
  //  * a canyon carrying a user-defined value on the system type
  //    (`permit_no`, which is appliesToAllTypes — the flag a new type inherits)
  //  * a place of a USER type carrying a value scoped to that type, which is
  //    what a copy has to reconcile
  //  * a place of a SYSTEM type that is not Canyon, so the Places screen has
  //    more than one populated tab and the zero-places hide rule is observable
  {
    id: cid(29),
    ownerId: ALICE_ID,
    name: "Rocky Creek Canyon",
    latitude: -33.4487,
    longitude: 150.3311,
    numAbseils: 4,
    longestAbseil: 18,
    vGrade: 3,
    aGrade: 2,
    commitment: 3,
    quality: 3.2,
    hours: 5,
    fieldValues: { permit_no: "NPWS-2026-114" },
  },
  {
    id: cid(30),
    ownerId: ALICE_ID,
    name: "Wollangambe Crater",
    latitude: -33.4602,
    longitude: 150.2588,
    placeTypeId: ALICE_TYPE_ID,
    quality: 4,
    fieldValues: {
      access_beta: "Park at the locked gate, walk the fire trail 20 min.",
    },
  },
  {
    id: cid(31),
    ownerId: ALICE_ID,
    name: "Newnes camp",
    latitude: -33.2074,
    longitude: 150.2247,
    placeTypeId: SYSTEM_PLACE_TYPE_IDS.campsite,
    quality: 4,
    fieldValues: { capacity: 12, is_cave: false },
  },
  // One value of each type a definition can have: string, float, date,
  // integer, boolean.
  {
    id: cid(32),
    ownerId: ALICE_ID,
    name: "Fabricated Pool",
    latitude: -33.52,
    longitude: 150.27,
    notes: "Fabricated place for local development.",
    quality: 3,
    fieldValues: {
      permit_no: "NPWS-2026-207",
      water_temp_c: 14.5,
      last_checked: "2026-08-02",
      rope_count: 2,
      needs_permit: true,
    },
  },
];

/** A made-up place that is only here to be of a type; nothing about it is real. */
const fabricated = (
  id: string,
  ownerId: string,
  name: string,
  latitude: number,
  longitude: number,
): SeedPlace => ({
  id,
  ownerId,
  name,
  latitude,
  longitude,
  notes: "Fabricated place for local development.",
  fieldValues: {},
});

// bob owns a fork of alice's shared Grand Canyon + two of his own.
const BOB_PLACES: SeedPlace[] = [
  {
    id: seedId("2", 1),
    ownerId: BOB_ID,
    name: "Grand Canyon (copy)",
    latitude: -33.6563,
    longitude: 150.3179,
    numAbseils: 1,
    longestAbseil: 20,
    vGrade: 2,
    aGrade: 2,
    commitment: 3,
    quality: 3.4,
    hours: 3,
    forkedFromId: PLACE_IDS[0],
    fieldValues: {},
  },
  {
    id: seedId("2", 2),
    ownerId: BOB_ID,
    name: "Coin Slot",
    latitude: -33.1224,
    longitude: 150.3297,
    numAbseils: 5,
    longestAbseil: 35,
    vGrade: 3,
    aGrade: 1,
    commitment: 4,
    quality: 4,
    hours: 3.5,
    fieldValues: {},
  },
  {
    id: seedId("2", 3),
    ownerId: BOB_ID,
    name: "Galah Canyon",
    latitude: -33.2514,
    longitude: 150.3037,
    numAbseils: 8,
    longestAbseil: 30,
    quality: 4,
    hours: 10,
    fieldValues: {},
  },
  {
    ...fabricated(seedId("2", 4), BOB_ID, "Galah camp", -33.2531, 150.3012),
    placeTypeId: SYSTEM_PLACE_TYPE_IDS.campsite,
    fieldValues: { capacity: 6 },
  },
  {
    ...fabricated(
      seedId("2", 5),
      BOB_ID,
      "Coin Slot lookout",
      -33.1202,
      150.3331,
    ),
    placeTypeId: BOB_TYPE_ID,
  },
];

// carol owns her own places (and is shared nothing of alice's — the stranger).
const CAROL_PLACES: SeedPlace[] = [
  {
    id: seedId("3", 1),
    ownerId: CAROL_ID,
    name: "Pipeline Canyon",
    latitude: -33.1658,
    longitude: 150.2634,
    numAbseils: 10,
    longestAbseil: 25,
    quality: 4,
    hours: 7,
    fieldValues: {},
  },
  {
    id: seedId("3", 2),
    ownerId: CAROL_ID,
    name: "Surefire Canyon",
    latitude: -33.2286,
    longitude: 150.2926,
    numAbseils: 5,
    longestAbseil: 15,
    quality: 4.5,
    hours: 12,
    fieldValues: {},
  },
  {
    ...fabricated(
      seedId("3", 3),
      CAROL_ID,
      "Surefire camp",
      -33.2301,
      150.2911,
    ),
    placeTypeId: SYSTEM_PLACE_TYPE_IDS.campsite,
    fieldValues: { capacity: 4 },
  },
  {
    ...fabricated(
      seedId("3", 4),
      CAROL_ID,
      "Pipeline lookout",
      -33.1671,
      150.2652,
    ),
    placeTypeId: CAROL_TYPE_ID,
  },
];

const ALL_PLACES = [...ALICE_PLACES, ...BOB_PLACES, ...CAROL_PLACES];

/** A seeded place's type, with the same Canyon default the insert applies. */
function seedPlaceTypeId(placeId: string): string {
  const place = ALL_PLACES.find((entry) => entry.id === placeId);
  if (!place) throw new Error(`seed trip links an unknown place ${placeId}`);
  return place.placeTypeId ?? SYSTEM_PLACE_TYPE_IDS.canyon;
}

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
              water_level: WATER[((seed / 3) % WATER.length) | 0],
              // TYPED to match their definitions, not stringified. A value of
              // the wrong type READS AS ABSENT everywhere (the forgiving-read
              // rule in shared/src/fieldValues.ts), so a stringified integer is
              // not a harmless variation — it is a value no reader can use.
              rope_length_m: 15 + ((seed * 5) % 50),
              wetsuit: seed % 2 === 0,
            }
          : undefined,
      });
    }
  }

  // alice: named no-place trips (displayName set, placeId null).
  for (const name of [
    "Newnes weekend (multi-place)",
    "Kanangra exploratory",
    "Wollangambe float",
    "Rescue practice day",
  ]) {
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
  trips.push({
    placeId: null,
    userId: BOB_ID,
    date: tripDate(seed),
    displayName: "Canyoning festival 2024",
    notes: "Three places in a day. Logged as one entry.",
  });

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

// ── Jobs, templates and what they leave in S3 ───────────────────────────────
//
// A COMPLETE job has its outputs in S3 behind it, as a vector file does: the
// topo ones are tiny real PMTiles archives (seedArchives.ts) at the keys the
// rows name, and a GeoPDF's result is the PDF Logjam's own generator wrote
// (shared/src/geoPdfImport/__fixtures__/logjam-a5.pdf). Every size a row states
// is the length of the bytes uploaded.

/** Minted per seed run; the invite row stores only its hash, as the route does. */
const SEED_FRIEND_INVITE_TOKEN = mintFriendInviteToken();
assertValid(
  "the seeded invite token",
  isFriendInviteToken(SEED_FRIEND_INVITE_TOKEN) ? null : "not a token",
);

const TOPO_TILE = tileAt(12, 150.3179, -33.6563);
const TOPO_BOUNDS = tileBounds(TOPO_TILE.z, TOPO_TILE.x, TOPO_TILE.y);
/** What the pipeline stores: the union of the per-tile coverage, here one tile. */
const TOPO_FOOTPRINT = {
  type: "Polygon" as const,
  coordinates: [
    [
      [TOPO_BOUNDS[0], TOPO_BOUNDS[1]],
      [TOPO_BOUNDS[2], TOPO_BOUNDS[1]],
      [TOPO_BOUNDS[2], TOPO_BOUNDS[3]],
      [TOPO_BOUNDS[0], TOPO_BOUNDS[3]],
      [TOPO_BOUNDS[0], TOPO_BOUNDS[1]],
    ],
  ],
};
/** A made-up contour across the tile, in tile units (extent 4096). */
const CONTOUR_LINE: [number, number][] = [
  [0, 2600],
  [1200, 2100],
  [2600, 2300],
  [4096, 1500],
];
/** The same line in degrees, so an export of the layer matches its tile. */
const CONTOUR_LONLAT = CONTOUR_LINE.map(([x, y]) => [
  TOPO_BOUNDS[0] + (x / 4096) * (TOPO_BOUNDS[2] - TOPO_BOUNDS[0]),
  TOPO_BOUNDS[3] - (y / 4096) * (TOPO_BOUNDS[3] - TOPO_BOUNDS[1]),
]);

type SeededObject = { key: string; body: Buffer | string; contentType: string };

const TOPO_LAYER_ARCHIVES = [
  { name: "hillshade", tile: flatPng(150), type: "png" as const },
  { name: "slope", tile: flatPng(95), type: "png" as const },
  {
    name: "contours",
    tile: lineVectorTile("contours", CONTOUR_LINE),
    type: "mvt" as const,
  },
].map((layer) => ({
  ...layer,
  archive: singleTilePmtiles({ ...TOPO_TILE, ...layer }),
}));

/** The outputs of a complete job: its rows' `s3OutputKeys` and the objects. */
function topoOutputs(jobId: string) {
  const keys = TOPO_LAYER_ARCHIVES.map((layer) => ({
    name: layer.name,
    // No COG: a raster layer's COG is what an export reads, and building one is
    // the worker's job. An export of a seeded topo is therefore refused as
    // "made before exports existed"; the completed export seeded below has its
    // result and needs no source. Nor can it be drawn on a new GeoPDF: the
    // archive is one z12 tile and the renderer reads z16.
    cogKey: null,
    pmtilesKey: `outputs/${jobId}/${layer.name}.pmtiles`,
  }));
  const objects: SeededObject[] = TOPO_LAYER_ARCHIVES.map((layer, i) => ({
    key: keys[i].pmtilesKey,
    body: layer.archive,
    contentType: "application/octet-stream",
  }));
  return {
    keys,
    objects,
    bytes: BigInt(
      TOPO_LAYER_ARCHIVES.reduce((sum, l) => sum + l.archive.length, 0),
    ),
  };
}

const GEO_PDF_FIXTURE = readFileSync(
  join(__dirname, "../../shared/src/geoPdfImport/__fixtures__/logjam-a5.pdf"),
);
/** The config that fixture was rendered from (see its README). */
const GEO_PDF_CONFIG: GeoPdfConfig = {
  paperSize: "A5",
  orientation: "landscape",
  extent: { north: -33.6, south: -33.7, east: 150.3, west: 150.2 },
  scale: 25000,
  baseLayer: "osm-topo",
  overlays: [],
  elements: {
    title: "Wollemi test sheet",
    compass: false,
    scaleText: false,
    scaleBar: false,
  },
};
/** A layout only: a template holds no extent. */
const GEO_PDF_TEMPLATE_CONFIG: Omit<GeoPdfConfig, "extent"> = {
  paperSize: "A4",
  orientation: "portrait",
  scale: 25000,
  baseLayer: "six-topo",
  overlays: ["hillshade"],
  elements: { compass: true, scaleText: true, scaleBar: true },
};

/** Puts seeded objects in a bucket; best effort for the reason uploadSeededFiles gives. */
async function uploadObjects(
  bucketVar: "S3_BUCKET_MEDIA" | "S3_BUCKET_TOPO",
  objects: SeededObject[],
): Promise<void> {
  const bucket = process.env[bucketVar];
  if (!bucket) {
    console.warn(`${bucketVar} is unset — seeded job files were not uploaded.`);
    return;
  }
  try {
    for (const object of objects) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: object.key,
          Body: object.body,
          ContentType: object.contentType,
        }),
      );
    }
    console.log(`Uploaded ${objects.length} seeded objects to s3://${bucket}/`);
  } catch (err) {
    console.warn(
      `Could not upload seeded job files (${(err as Error).message}). The rows still exist; their downloads and tiles will report a file that isn't there.`,
    );
  }
}

/** Throws when a seeded config is one the API would refuse to store. */
function assertValid(what: string, error: string | null): void {
  if (error) throw new Error(`seed: ${what} is invalid: ${error}`);
}

async function main() {
  // Delete in reverse FK dependency order (Postgres enforces constraints per
  // statement). Every seeded table is NAMED here even where `user.deleteMany()`
  // would cascade it: this is a hand-kept list that must agree with what the
  // seed writes, and relying on cascade order means a future table with no user
  // FK survives the wipe silently. Guarded by src/lib/seedWipe.unit.test.ts.
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
    prisma.announcement.deleteMany(),
    prisma.topoJob.deleteMany(),
    prisma.topoExportJob.deleteMany(),
    prisma.geoPdfJob.deleteMany(),
    prisma.geoPdfTemplate.deleteMany(),
    prisma.topoTemplate.deleteMany(),
    prisma.fileSendRecipient.deleteMany(),
    prisma.fileSend.deleteMany(),
    prisma.friendInvite.deleteMany(),
    prisma.deviceToken.deleteMany(),
    prisma.syncTombstone.deleteMany(),
    prisma.egressLogCursor.deleteMany(),
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
      {
        id: BOB_ID,
        cognitoId: BOB_COGNITO_ID,
        username: "bob",
        email: "bob@local",
        consentedAt,
        consentVersion: CURRENT_CONSENT_VERSION,
      },
      {
        id: CAROL_ID,
        cognitoId: CAROL_COGNITO_ID,
        username: "carol",
        email: "carol@local",
        consentedAt,
        consentVersion: CURRENT_CONSENT_VERSION,
      },
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
      // From the curated palette, like any type a user could make, so dev
      // holds no colour the API would refuse to save.
      color: PLACE_TYPE_COLORS[6],
      position: 0,
    },
  });

  await prisma.placeType.createMany({
    data: [
      {
        id: BOB_TYPE_ID,
        ownerId: BOB_ID,
        name: "Lookout",
        iconKey: "droplet",
        color: PLACE_TYPE_COLORS[2],
        position: 0,
      },
      {
        id: CAROL_TYPE_ID,
        ownerId: CAROL_ID,
        name: "Swim spot",
        iconKey: "droplet",
        color: PLACE_TYPE_COLORS[4],
        position: 0,
      },
    ],
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

  // Place-scoped definitions alice owns, plus their scoping rows. Makes the
  // field machinery VISIBLE in dev so the nested `attributes.customFields`
  // shape is present in dev data.
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
                create: def.placeTypeIds.map((placeTypeId) => ({
                  placeTypeId,
                })),
              },
            }
          : {}),
      },
    });
  }

  // Friendships: alice<->bob accepted (invariant), carol->alice pending
  // (invariant), bob<->carol accepted (extra graph; does NOT make carol alice's
  // friend, so the share->carol 403 test still holds).
  await prisma.friendship.create({
    data: {
      id: seedId("d", 1),
      requesterId: ALICE_ID,
      addresseeId: BOB_ID,
      status: "accepted",
    },
  });
  const carolPending = await prisma.friendship.create({
    data: {
      id: seedId("d", 2),
      requesterId: CAROL_ID,
      addresseeId: ALICE_ID,
      status: "pending",
    },
  });
  await prisma.friendship.create({
    data: {
      id: seedId("d", 3),
      requesterId: BOB_ID,
      addresseeId: CAROL_ID,
      status: "accepted",
    },
  });

  // Places. Forks reference an existing id, so insert non-forks first.
  for (const c of ALL_PLACES.filter((c) => !c.forkedFromId)) {
    await prisma.place.create({ data: placeCreate(c) });
  }
  for (const c of ALL_PLACES.filter((c) => c.forkedFromId)) {
    await prisma.place.create({ data: placeCreate(c) });
  }

  // Shares: anchors 0 & 1 (invariant) + two more, all alice->bob. carol gets none.
  await prisma.placeShare.createMany({
    data: [PLACE_IDS[0], PLACE_IDS[1], cid(6), cid(9)].map((placeId, i) => ({
      id: seedId("e", i + 1),
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
      id: seedId("e", 5),
      placeId: BOB_SHARED_PLACE_ID,
      sharedById: BOB_ID,
      sharedWithId: ALICE_ID,
    },
  });

  // MARKER places and routes. Waypoints are places of the system Marker type.
  // The set covers every combination the row builders branch on:
  //   owned, unshared            → no mark
  //   owned + a place share      → the fan-out glyph
  //   received via place share   → "From bob": the owner resolves through the
  //                                mirrored place_shares row.
  await prisma.place.createMany({
    data: [
      {
        id: wpid(1),
        ownerId: ALICE_ID,
        placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker,
        name: "Grand Canyon carpark",
        latitude: -33.6501,
        longitude: 150.3122,
        elevation: 1010,
      },
      {
        id: wpid(2),
        ownerId: ALICE_ID,
        placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker,
        name: "Claustral first abseil",
        latitude: -33.5611,
        longitude: 150.4041,
        elevation: 880,
        notes: "Tree anchor on the true left.",
      },
      {
        id: wpid(3),
        ownerId: ALICE_ID,
        placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker,
        name: "Ranger station",
        latitude: -33.7188,
        longitude: 150.3099,
      },
      {
        id: wpid(4),
        ownerId: BOB_ID,
        placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker,
        name: "Coin Slot pothole",
        latitude: -33.1231,
        longitude: 150.3288,
        elevation: 720,
        notes: "Bob's note — a sharee must not be able to edit this.",
      },
      {
        id: wpid(5),
        ownerId: BOB_ID,
        placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker,
        name: "Galah exit gully",
        latitude: -33.2521,
        longitude: 150.3044,
      },
      {
        id: wpid(6),
        ownerId: CAROL_ID,
        placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker,
        name: "Surefire carpark",
        latitude: -33.2279,
        longitude: 150.2919,
      },
    ],
  });

  // Links between places — navigational only. A link grants NO visibility, so
  // wpid(4) does NOT reach alice through bob's shared place: she sees
  // the place she was shared, and nothing it points at. Both endpoints of every
  // link belong to one owner, which the server asserts on create.
  await prisma.placeLink.createMany({
    data: [
      {
        id: seedId("6", 101),
        ownerId: ALICE_ID,
        ...canonicalLinkPair(PLACE_IDS[0], wpid(1)),
      },
      {
        id: seedId("6", 102),
        ownerId: ALICE_ID,
        ...canonicalLinkPair(PLACE_IDS[1], wpid(2)),
      },
      {
        id: seedId("6", 103),
        ownerId: BOB_ID,
        ...canonicalLinkPair(BOB_SHARED_PLACE_ID, wpid(4)),
      },
    ],
  });

  // A place holds ONE way — a drawn route or an attached file, never both
  // (shared/mobile routeSlot.ts, and assertPlaceTrackSlotFree on the media
  // side), as no client can produce both. Each place below carries at most
  // one, and the places that carry a FILE are named in the media block.
  await prisma.route.createMany({
    data: [
      {
        id: rtid(1),
        ownerId: ALICE_ID,
        placeId: PLACE_IDS[1],
        name: "Claustral through-trip",
        color: TRACK_COLORS[3],
        points: CLAUSTRAL_LINE,
        anchors: [0, 4, CLAUSTRAL_LINE.length - 1],
      },
      {
        id: rtid(2),
        ownerId: ALICE_ID,
        placeId: null,
        name: "Du Faur Head approach",
        color: TRACK_COLORS[4],
        points: DU_FAUR_LINE,
        anchors: Prisma.DbNull,
      },
      // Bob's route is unlinked, so his Coin Slot can carry the track file
      // below. It keeps its direct share to alice, which is the whole point of
      // it: a route shared with you on its own row, removable by you.
      {
        id: rtid(3),
        ownerId: BOB_ID,
        placeId: null,
        name: "Coin Slot approach",
        color: TRACK_COLORS[5],
        points: COIN_SLOT_LINE,
        anchors: [0, COIN_SLOT_LINE.length - 1],
      },
      {
        id: rtid(4),
        ownerId: ALICE_ID,
        placeId: cid(6),
        name: "Butterbox descent",
        color: TRACK_COLORS[6],
        points: BUTTERBOX_LINE,
        anchors: [0, 3, BUTTERBOX_LINE.length - 1],
      },
      {
        id: rtid(5),
        ownerId: ALICE_ID,
        placeId: PLACE_IDS[0],
        name: "Grand Canyon descent",
        color: TRACK_COLORS[7],
        points: GRAND_CANYON_LINE,
        anchors: [0, GRAND_CANYON_LINE.length - 1],
      },
      {
        id: rtid(6),
        ownerId: ALICE_ID,
        placeId: cid(14),
        name: "Wollangambe One float",
        color: TRACK_COLORS[8],
        points: WOLLANGAMBE_LINE,
        anchors: [0, 4, WOLLANGAMBE_LINE.length - 1],
      },
      {
        id: rtid(7),
        ownerId: ALICE_ID,
        placeId: null,
        name: "Kanangra tops walk in",
        color: TRACK_COLORS[9],
        points: KANANGRA_LINE,
        anchors: Prisma.DbNull,
      },
    ],
  });

  // Direct per-item shares — the second, independent visibility source
  // (lib/shareAccess.ts), and the only thing that puts a number in a ROUTE's
  // sharedCount. A place is never shared this way (PlaceShare is its own
  // table). alice's fan-out is 1 because bob is her only friend: carol is shared
  // nothing and is not her friend, and sharing.test.ts asserts a 403 on
  // share->carol.
  await prisma.share.createMany({
    data: [
      {
        id: seedId("8", 2),
        entityType: "route",
        entityId: rtid(1),
        sharedById: ALICE_ID,
        sharedWithId: BOB_ID,
      },
      // The INCOMING direction, so every sharee-perspective surface (a
      // read-only row, a "Shared with you" mark, a refused delete) is
      // reachable in dev without hand-creating data as two users.
      {
        id: seedId("8", 3),
        entityType: "route",
        entityId: rtid(3),
        sharedById: BOB_ID,
        sharedWithId: ALICE_ID,
      },
    ],
  });

  // Trip logs. `types` goes through enforceCanyoningTag, the same derivation
  // POST /trips applies — the seed writes via Prisma directly and so bypasses
  // the route's enforcement, which would otherwise leave every seeded trip
  // untagged and make dev the one environment where the trip-type filter has
  // an empty vocabulary.
  //
  // Ids are pinned like every other seeded row: a re-seed deletes trips
  // without tombstones, so random ids left a paired phone holding every past
  // seed's trips on top of the new ones.
  const trips = buildTrips();
  for (const [i, t] of trips.entries()) {
    await prisma.tripLog.create({
      data: {
        id: seedId("c", i + 1),
        userId: t.userId,
        date: t.date,
        displayName: t.displayName,
        notes: t.notes,
        types: enforceCanyoningTag(
          [],
          linksCanyon(t.placeId ? [seedPlaceTypeId(t.placeId)] : []),
        ),
        ...(t.customFields ? { customFields: t.customFields } : {}),
        ...(t.placeId
          ? { places: { create: [{ placeId: t.placeId, position: 0 }] } }
          : {}),
      },
    });
  }

  // The five vector files the rows below describe. Generated from the lines
  // above and uploaded now, so every figure a row states — extent, point count,
  // length, size — is read back off the bytes rather than typed by hand.
  const empressFile = seededFile(
    "media/seed/empress-falls.gpx",
    "Empress Falls abseils",
    EMPRESS_FALLS_LINE,
    "gpx",
  );
  const duFaurFile = seededFile(
    "media/seed/du-faur.kml",
    "Du Faur approach",
    DU_FAUR_LINE,
    "kml",
  );
  const coinSlotFile = seededFile(
    "media/seed/coin-slot.gpx",
    "Coin Slot descent",
    COIN_SLOT_DESCENT_LINE,
    "gpx",
  );
  const wollangambeFile = seededFile(
    "media/seed/recording-2026-08-02.gpx",
    "Wollangambe, 2 Aug",
    WOLLANGAMBE_LINE,
    "gpx",
    WOLLANGAMBE_RECORDED,
  );
  const bellCreekFile = seededFile(
    "media/seed/recording-2026-05-17.gpx",
    "Bell Creek, 17 May",
    BELL_CREEK_LINE,
    "gpx",
    BELL_CREEK_RECORDED,
  );
  await uploadSeededFiles([
    empressFile,
    duFaurFile,
    coinSlotFile,
    wollangambeFile,
    bellCreekFile,
  ]);
  await uploadPlaceRegistry();

  // Media. Every VECTOR row has a real object behind it (above); the photo is
  // still metadata only, so its thumbnail will not load — generating a
  // believable JPEG is a different job from generating a believable track, and
  // a photo is not what a way's page draws.
  //
  // Covers all three parent states, because they behave differently: a photo
  // ATTACHED to a place (dies with it), a standalone import LINKED as a place's
  // way (survives the place, and is the shape a sharee sees), and an unlinked
  // recording (owner-private, in Saved and nowhere else). A seed with only
  // attachments leaves every standalone path untested by the integration suite.
  await prisma.media.createMany({
    data: [
      {
        id: seedId("4", 1),
        ownerId: ALICE_ID,
        linkedType: "place",
        linkedId: PLACE_IDS[0],
        s3KeyDisplay: "media/seed/grand-1.jpg",
        s3KeyThumbnail: "media/seed/grand-1-thumb.jpg",
        mediaType: "image/jpeg",
        filename: "grand-canyon.jpg",
        fileSizeBytes: BigInt(2_048_000),
      },
      // Empress Falls carries a FILE as its way (no route is linked to it), and
      // its extent sits on Empress Falls. Every extent below is the file's own,
      // so it brackets the place it belongs to by construction.
      {
        id: seedId("4", 2),
        ownerId: ALICE_ID,
        linkedType: "place",
        linkedId: PLACE_IDS[2],
        s3KeyDisplay: empressFile.key,
        mediaType: empressFile.contentType,
        filename: "empress-falls.gpx",
        displayName: "Empress Falls abseils",
        fileSizeBytes: BigInt(empressFile.fileSizeBytes),
        color: TRACK_COLORS[0],
        origin: "import",
        metadata: {
          bbox: empressFile.bbox,
          featureCount: 1,
          positionCount: empressFile.positionCount,
        },
      },
      {
        id: seedId("4", 3),
        ownerId: ALICE_ID,
        linkedType: "none",
        linkedId: null,
        s3KeyDisplay: duFaurFile.key,
        mediaType: duFaurFile.contentType,
        filename: "du-faur-approach.kml",
        displayName: "Du Faur approach",
        fileSizeBytes: BigInt(duFaurFile.fileSizeBytes),
        color: TRACK_COLORS[1],
        origin: "import",
        metadata: {
          bbox: duFaurFile.bbox,
          featureCount: 1,
          positionCount: duFaurFile.positionCount,
        },
      },
      {
        id: seedId("4", 4),
        ownerId: ALICE_ID,
        linkedType: "none",
        linkedId: null,
        s3KeyDisplay: wollangambeFile.key,
        mediaType: wollangambeFile.contentType,
        filename: "Wollangambe, 2 Aug.gpx",
        displayName: "Wollangambe, 2 Aug",
        fileSizeBytes: BigInt(wollangambeFile.fileSizeBytes),
        color: TRACK_COLORS[2],
        origin: "track",
        metadata: {
          bbox: wollangambeFile.bbox,
          distanceM: wollangambeFile.distanceM,
          durationMs: 1_500_000,
          elevationGainM: 95,
          elevationLossM: 130,
          // The finest source, so opening the page finds nothing finer and
          // writes nothing: the a11y e2e cases (frontend/e2e/a11y.spec.ts) must
          // not change the account.
          elevationSource: "nsw-5m",
          pointCount: wollangambeFile.positionCount,
          ...WOLLANGAMBE_RECORDED,
        },
      },
      // BOB's file on the place he shares with alice. This is the only way a
      // track on someone ELSE's place is reachable in dev, and it is what the
      // Ways page lists beside alice's own files.
      {
        id: seedId("4", 5),
        ownerId: BOB_ID,
        linkedType: "place",
        linkedId: BOB_SHARED_PLACE_ID,
        s3KeyDisplay: coinSlotFile.key,
        mediaType: coinSlotFile.contentType,
        filename: "coin-slot.gpx",
        displayName: "Coin Slot descent",
        fileSizeBytes: BigInt(coinSlotFile.fileSizeBytes),
        color: TRACK_COLORS[3],
        origin: "import",
        metadata: {
          bbox: coinSlotFile.bbox,
          featureCount: 1,
          positionCount: coinSlotFile.positionCount,
        },
      },
      // A second recording of alice's, so Tracks is not a single row and the
      // kind rail has something to narrow.
      {
        id: seedId("4", 6),
        ownerId: ALICE_ID,
        linkedType: "none",
        linkedId: null,
        s3KeyDisplay: bellCreekFile.key,
        mediaType: bellCreekFile.contentType,
        filename: "Bell Creek, 17 May.gpx",
        displayName: "Bell Creek, 17 May",
        fileSizeBytes: BigInt(bellCreekFile.fileSizeBytes),
        color: TRACK_COLORS[4],
        origin: "track",
        metadata: {
          bbox: bellCreekFile.bbox,
          distanceM: bellCreekFile.distanceM,
          durationMs: 1_500_000,
          elevationGainM: 70,
          elevationLossM: 95,
          // The finest source, so opening the page finds nothing finer and
          // writes nothing: the a11y e2e cases (frontend/e2e/a11y.spec.ts) must
          // not change the account.
          elevationSource: "nsw-5m",
          pointCount: bellCreekFile.positionCount,
          ...BELL_CREEK_RECORDED,
        },
      },
    ],
  });

  // Jobs, templates and everything an account's background work leaves behind.
  // Ids are the "f" space. `ago` keeps the dates relative to the seed run, so a
  // completed export is never older than the sweeps that expire it.
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const fid = (n: number) => seedId("f", n);

  // A made-up token: CI points EXPO_PUSH_URL at a stub and local dev reaches
  // Expo, which refuses it and lets the API prune the row (services/push.ts).
  await prisma.deviceToken.create({
    data: {
      id: fid(19),
      userId: ALICE_ID,
      token: "ExponentPushToken[seed-alice-device]",
      platform: "android",
    },
  });

  const aliceTopo = fid(1);
  const bobTopo = fid(4);
  const aliceTopoOutputs = topoOutputs(aliceTopo);
  const bobTopoOutputs = topoOutputs(bobTopo);
  // What a finished run costs the owner's monthly credits is its elapsed time
  // (lib/computeCredits.ts): the worker's own `wallSeconds` for a complete
  // topo, `updatedAt - startedAt` for a failed one. Both are minutes here, as
  // a run of one tile is, so seeding spends nothing worth noticing.
  const topoRun = (endedMinutesAgo: number, wallSeconds: number) => ({
    attemptCount: 1,
    startedAt: ago(endedMinutesAgo + wallSeconds / 60),
    updatedAt: ago(endedMinutesAgo),
  });
  const pipelineMetrics = (wallSeconds: number) => ({
    schemaVersion: 1,
    wallSeconds,
    phases: { pdal: wallSeconds / 2, render: wallSeconds / 2 },
    inputTileCount: 1,
    outputTileCount: 1,
    zoomMin: TOPO_TILE.z,
    zoomMax: TOPO_TILE.z,
  });
  await prisma.topoJob.createMany({
    data: [
      // Complete: what Logjam Web's Maps page and GeoPDF dialog need to draw a
      // topo and offer it as a layer.
      {
        id: aliceTopo,
        userId: ALICE_ID,
        status: "complete",
        name: "Grand Canyon LiDAR",
        footprint: TOPO_FOOTPRINT,
        tileCount: 1,
        estimatedSeconds: 600,
        outputTileCount: 1,
        s3OutputKeys: aliceTopoOutputs.keys,
        outputBytes: aliceTopoOutputs.bytes,
        vectorStyleSnapshot: VECTOR_STYLE_DEFAULTS as object,
        createdAt: ago(300),
        pipelineMetrics: pipelineMetrics(300),
        ...topoRun(285, 300),
      },
      {
        id: fid(2),
        userId: ALICE_ID,
        status: "failed",
        name: "Wollangambe LiDAR",
        tileCount: 2,
        estimatedSeconds: 1200,
        errorMessage: TOPO_UNREADABLE_MESSAGE,
        createdAt: ago(200),
        ...topoRun(188, 120),
      },
      // Bob's, shared with alice (below): read-only to her.
      {
        id: bobTopo,
        userId: BOB_ID,
        status: "complete",
        name: "Coin Slot LiDAR",
        footprint: TOPO_FOOTPRINT,
        tileCount: 1,
        estimatedSeconds: 600,
        outputTileCount: 1,
        s3OutputKeys: bobTopoOutputs.keys,
        outputBytes: bobTopoOutputs.bytes,
        vectorStyleSnapshot: VECTOR_STYLE_DEFAULTS as object,
        createdAt: ago(400),
        pipelineMetrics: pipelineMetrics(300),
        ...topoRun(385, 300),
      },
    ],
  });

  const exportDone = fid(5);
  const exportFile = JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { layer: "contours" },
        geometry: { type: "LineString", coordinates: CONTOUR_LONLAT },
      },
    ],
  });
  await prisma.topoExportJob.createMany({
    data: [
      {
        id: exportDone,
        userId: ALICE_ID,
        sourceJobIds: [aliceTopo],
        layers: ["contours"],
        format: "geojson",
        bundling: "per-layer",
        vectorStyleSnapshot: VECTOR_STYLE_DEFAULTS as object,
        sourceTileCount: 1,
        estimatedSeconds: 60,
        status: "completed",
        resultKey: `exports/${exportDone}/contours.geojson`,
        resultBytes: BigInt(Buffer.byteLength(exportFile)),
        startedAt: ago(100),
        createdAt: ago(105),
        completedAt: ago(98),
      },
      {
        id: fid(6),
        userId: ALICE_ID,
        sourceJobIds: [aliceTopo],
        layers: ["contours"],
        format: "gpkg",
        bundling: "composite",
        vectorStyleSnapshot: VECTOR_STYLE_DEFAULTS as object,
        sourceTileCount: 1,
        estimatedSeconds: 60,
        status: "failed",
        errorMessage: TOPO_EXPORT_STOPPED_MESSAGE,
        startedAt: ago(70),
        createdAt: ago(75),
        completedAt: ago(67),
      },
    ],
  });

  assertValid("the GeoPDF config", validateGeoPdfConfig(GEO_PDF_CONFIG));
  const geoPdfDone = fid(7);
  const bobGeoPdf = fid(9);
  const geoPdfResult = (id: string) => ({
    resultKey: `exports/geo-pdf/${id}/logjam-export.pdf`,
    resultBytes: BigInt(GEO_PDF_FIXTURE.length),
  });
  await prisma.geoPdfJob.createMany({
    data: [
      {
        id: geoPdfDone,
        userId: ALICE_ID,
        config: GEO_PDF_CONFIG as object,
        vectorStyleSnapshot: VECTOR_STYLE_DEFAULTS as object,
        estimatedSeconds: 30,
        status: "completed",
        ...geoPdfResult(geoPdfDone),
        startedAt: ago(60),
        createdAt: ago(62),
        completedAt: ago(58),
      },
      {
        id: fid(8),
        userId: ALICE_ID,
        config: {
          ...GEO_PDF_CONFIG,
          elements: { ...GEO_PDF_CONFIG.elements, title: "Failed test sheet" },
        } as object,
        vectorStyleSnapshot: VECTOR_STYLE_DEFAULTS as object,
        estimatedSeconds: 30,
        status: "failed",
        errorMessage: GEO_PDF_FAILURE_MESSAGE,
        startedAt: ago(50),
        createdAt: ago(52),
        completedAt: ago(48),
      },
      {
        id: bobGeoPdf,
        userId: BOB_ID,
        config: GEO_PDF_CONFIG as object,
        vectorStyleSnapshot: VECTOR_STYLE_DEFAULTS as object,
        estimatedSeconds: 30,
        status: "completed",
        ...geoPdfResult(bobGeoPdf),
        startedAt: ago(90),
        createdAt: ago(92),
        completedAt: ago(88),
      },
    ],
  });

  await prisma.share.createMany({
    data: [
      {
        id: seedId("8", 4),
        entityType: "topoJob",
        entityId: bobTopo,
        sharedById: BOB_ID,
        sharedWithId: ALICE_ID,
      },
      {
        id: seedId("8", 5),
        entityType: "geoPdfJob",
        entityId: bobGeoPdf,
        sharedById: BOB_ID,
        sharedWithId: ALICE_ID,
      },
    ],
  });

  // Templates of both kinds, validated as the routes validate them so the seed
  // cannot hold a config the API would refuse to store.
  assertValid(
    "the GeoPDF template",
    validateGeoPdfTemplateConfig(GEO_PDF_TEMPLATE_CONFIG),
  );
  const topoTemplateConfig = validateRasterTemplateSettings({
    ...RASTER_TEMPLATE_DEFAULTS,
    hillshade: { ...RASTER_TEMPLATE_DEFAULTS.hillshade, azimuth: 270 },
  });
  if (!topoTemplateConfig.ok) {
    throw new Error(
      `seed: the topo template is invalid: ${topoTemplateConfig.errors.join("; ")}`,
    );
  }
  await prisma.geoPdfTemplate.createMany({
    data: [
      {
        id: fid(10),
        userId: ALICE_ID,
        name: "A4 portrait with hillshade",
        config: GEO_PDF_TEMPLATE_CONFIG as object,
      },
      {
        id: fid(11),
        userId: BOB_ID,
        name: "Bob's A4",
        config: { ...GEO_PDF_TEMPLATE_CONFIG, overlays: [] } as object,
      },
    ],
  });
  await prisma.topoTemplate.createMany({
    data: [
      {
        id: fid(12),
        userId: ALICE_ID,
        name: "Low sun",
        config: topoTemplateConfig.value as object,
      },
      {
        id: fid(13),
        userId: BOB_ID,
        name: "Bob's default",
        config: RASTER_TEMPLATE_DEFAULTS as object,
      },
    ],
  });

  // Sends are copies: a pending one for alice to accept and an accepted one
  // she made. Each has its object in the media bucket, under the key
  // lib/fileSendAccess.ts fileSendKey gives it today (a download reads the
  // row's own key, so a change there strands only the seeded object).
  const bobSend = fid(14);
  const aliceSend = fid(15);
  const sendExpires = new Date(
    Date.now() + FILE_SEND_TTL_DAYS * 24 * 60 * 60_000,
  );
  await prisma.fileSend.createMany({
    data: [
      {
        id: bobSend,
        senderId: BOB_ID,
        sourceKind: "import",
        filename: "coin-slot.gpx",
        s3Key: `file-sends/${BOB_ID}/${bobSend}/copy.gpx`,
        sizeBytes: BigInt(coinSlotFile.fileSizeBytes),
        expiresAt: sendExpires,
      },
      {
        id: aliceSend,
        senderId: ALICE_ID,
        sourceKind: "track",
        filename: "Wollangambe, 2 Aug.gpx",
        s3Key: `file-sends/${ALICE_ID}/${aliceSend}/copy.gpx`,
        sizeBytes: BigInt(wollangambeFile.fileSizeBytes),
        expiresAt: sendExpires,
      },
    ],
  });
  await prisma.fileSendRecipient.createMany({
    data: [
      { id: fid(16), fileSendId: bobSend, userId: ALICE_ID, status: "pending" },
      {
        id: fid(17),
        fileSendId: aliceSend,
        userId: BOB_ID,
        status: "accepted",
        respondedAt: ago(30),
      },
    ],
  });

  // A pending invite link from alice, for another user to open: the seed prints
  // it, as only its hash is stored. Alice's, since friendInvites.test.ts clears
  // bob's and carol's.
  await prisma.friendInvite.create({
    data: {
      id: fid(18),
      inviterId: ALICE_ID,
      tokenHash: hashFriendInviteToken(SEED_FRIEND_INVITE_TOKEN),
      expiresAt: new Date(
        Date.now() + FRIEND_INVITE_TTL_DAYS * 24 * 60 * 60_000,
      ),
    },
  });

  // Deletions a phone has yet to hear about. The ids name nothing: the rows are
  // gone, which is what a tombstone says.
  await prisma.syncTombstone.createMany({
    data: [
      { userId: ALICE_ID, entityType: "place", entityId: seedId("1", 900) },
      { userId: ALICE_ID, entityType: "media", entityId: seedId("4", 900) },
      { userId: ALICE_ID, entityType: "route", entityId: seedId("7", 900) },
      { userId: BOB_ID, entityType: "place", entityId: seedId("2", 900) },
    ],
  });

  await uploadObjects("S3_BUCKET_TOPO", [
    ...aliceTopoOutputs.objects,
    ...bobTopoOutputs.objects,
    {
      key: `exports/${exportDone}/contours.geojson`,
      body: exportFile,
      contentType: "application/geo+json",
    },
    ...[geoPdfDone, bobGeoPdf].map((id) => ({
      key: geoPdfResult(id).resultKey,
      body: GEO_PDF_FIXTURE,
      contentType: "application/pdf",
    })),
  ]);
  await uploadObjects("S3_BUCKET_MEDIA", [
    {
      key: `file-sends/${BOB_ID}/${bobSend}/copy.gpx`,
      body: coinSlotFile.body,
      contentType: coinSlotFile.contentType,
    },
    {
      key: `file-sends/${ALICE_ID}/${aliceSend}/copy.gpx`,
      body: wollangambeFile.body,
      contentType: wollangambeFile.contentType,
    },
  ]);

  // Notifications: one of every stored type for alice, with the payload its
  // producer writes (the producer is named on each). Payloads carry ids only;
  // names are resolved at read time (routes/notifications.ts). The types are
  // NOTIFICATION_TYPES, and src/lib/seedCoverage.unit.test.ts holds the seed to
  // them. Bob's two place_shared rows predate this block.
  const egressQuota = 53_687_091_200n; // the column default
  // Made up, and using every piece of the Markdown subset the clients draw
  // (shared/src/announcementMarkdown.ts), all three heading levels included,
  // so the dialog shows them all.
  const announcement = await prisma.announcement.create({
    data: {
      id: fid(20),
      title: "Logjam is moving to a new server",
      body: [
        "Logjam will be **offline for about an hour** on Saturday morning while it moves.",
        "",
        "# What to expect",
        "",
        "- Logjam GPS keeps recording and *syncs* when it is back.",
        "- Logjam Web shows `Couldn't reach Logjam` until then.",
        "",
        "## If something looks wrong",
        "",
        "1. Pull to refresh.",
        "2. Sign out and in again.",
        "",
        "### On Logjam GPS",
        "",
        "Recorded tracks wait on the phone until it syncs.",
        "",
        "Questions go to [the issue tracker](https://example.com/issues) or [email](mailto:maintainer@example.com).  ",
        "Thanks for your patience.",
      ].join("\n"),
    },
  });
  await prisma.notification.createMany({
    data: [
      {
        userId: BOB_ID,
        type: "place_shared",
        payload: { placeId: PLACE_IDS[0], sharedById: ALICE_ID },
        read: false,
      },
      {
        userId: BOB_ID,
        type: "place_shared",
        payload: { placeId: PLACE_IDS[1], sharedById: ALICE_ID },
        read: true,
      },
      // routes/friends.ts
      {
        userId: ALICE_ID,
        type: "friend_request",
        payload: { friendshipId: carolPending.id, requesterId: CAROL_ID },
        read: false,
        createdAt: ago(5),
      },
      // routes/friends.ts, on acceptance
      {
        userId: ALICE_ID,
        type: "friend_request_accepted",
        payload: { friendshipId: seedId("d", 1), acceptedById: BOB_ID },
        read: true,
        createdAt: ago(600),
      },
      // routes/sharing.ts
      {
        userId: ALICE_ID,
        type: "place_shared",
        payload: { placeId: BOB_SHARED_PLACE_ID, sharedById: BOB_ID },
        read: false,
        createdAt: ago(120),
      },
      // routes/shares.ts
      {
        userId: ALICE_ID,
        type: "item_shared",
        payload: { entityType: "route", entityId: rtid(3), sharedById: BOB_ID },
        read: false,
        createdAt: ago(110),
      },
      // routes/fileSends.ts
      {
        userId: ALICE_ID,
        type: "file_sent",
        payload: { fileSendId: bobSend, sentById: BOB_ID },
        read: false,
        createdAt: ago(25),
      },
      // topo/worker.py
      {
        userId: ALICE_ID,
        type: "topo_complete",
        payload: {
          jobId: aliceTopo,
          jobName: "Grand Canyon LiDAR",
          footprint: TOPO_FOOTPRINT,
          osmFailed: false,
        },
        read: true,
        createdAt: ago(285),
      },
      // topo/worker.py's failure path
      {
        userId: ALICE_ID,
        type: "topo_failed",
        payload: { jobId: fid(2), jobName: "Wollangambe LiDAR" },
        read: false,
        createdAt: ago(188),
      },
      // topo/export_worker.py
      {
        userId: ALICE_ID,
        type: "topo_export_complete",
        payload: {
          exportJobId: exportDone,
          format: "geojson",
          jobName: "Grand Canyon LiDAR",
          status: "completed",
          errorMessage: null,
        },
        read: false,
        createdAt: ago(98),
      },
      // No longer sent (auto-export is gone); an older one still shows.
      {
        userId: ALICE_ID,
        type: "topo_export_skipped",
        payload: {
          topoJobId: aliceTopo,
          reason: "none of the chosen layers were produced by this job",
        },
        read: false,
        createdAt: ago(280),
      },
      // api/src/worker/geoPdfWorker.ts: both outcomes use this type
      {
        userId: ALICE_ID,
        type: "geo_pdf_complete",
        payload: {
          geoPdfJobId: geoPdfDone,
          status: "completed",
          errorMessage: null,
        },
        read: false,
        createdAt: ago(58),
      },
      {
        userId: ALICE_ID,
        type: "geo_pdf_complete",
        payload: {
          geoPdfJobId: fid(8),
          status: "failed",
          errorMessage: GEO_PDF_FAILURE_MESSAGE,
        },
        read: false,
        createdAt: ago(48),
      },
      // lib/egressMeter.ts: the two numbers, stringified
      {
        userId: ALICE_ID,
        type: "egress_quota_warning",
        payload: {
          usedBytes: ((egressQuota * 85n) / 100n).toString(),
          quotaBytes: egressQuota.toString(),
        },
        read: true,
        createdAt: ago(1500),
      },
      // src/scripts/announce.ts
      {
        userId: ALICE_ID,
        type: "announcement",
        payload: { announcementId: announcement.id },
        read: false,
        createdAt: ago(1),
      },
      {
        userId: ALICE_ID,
        type: "egress_quota_exceeded",
        payload: {
          usedBytes: egressQuota.toString(),
          quotaBytes: egressQuota.toString(),
        },
        read: true,
        createdAt: ago(1400),
      },
    ],
  });

  // Last: the integration suite refuses to run on a database that differs
  // from this (src/__tests__/_seedBaseline.ts).
  await saveSeedSnapshot(prisma);

  console.log(
    `Seed complete: 3 users, ${ALL_PLACES.length} places (1 fork), 5 place shares ` +
      `(1 incoming to alice), 4 direct shares (3 incoming to alice), ` +
      `${trips.length} trip logs, 6 marker places, 3 place links, 7 routes, ` +
      `6 media, 3 topo jobs, 2 topo exports, 3 GeoPDFs, 4 templates, ` +
      `2 file sends, 1 invite, 4 tombstones, 1 announcement, ` +
      `${NOTIFICATION_TYPES.length} notification types`,
  );
  console.log(
    `Alice's invite link, for another user: open Logjam Web at ${friendInviteUrl("", SEED_FRIEND_INVITE_TOKEN)}`,
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
    ...(c.forkedFromId
      ? { forkedFrom: { connect: { id: c.forkedFromId } } }
      : {}),
  };
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
