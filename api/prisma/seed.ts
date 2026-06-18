import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrlFromEnv } from "../src/lib/databaseUrl";

const adapter = new PrismaPg({ connectionString: databaseUrlFromEnv() });
const prisma = new PrismaClient({ adapter });

const ALICE_ID = "00000000-0000-0000-0000-000000000001";
const BOB_ID = "00000000-0000-0000-0000-000000000002";
const CAROL_ID = "00000000-0000-0000-0000-000000000003";

// Matches FAKE_USER_SUB default in auth middleware and the Terraform-generated
// .env.local (infra/terraform/templates/env.local.tftpl)
const ALICE_COGNITO_ID = "fake-alice-sub";
const BOB_COGNITO_ID = "fake-bob-sub";
const CAROL_COGNITO_ID = "fake-carol-sub";

const CANYON_IDS = [
  "10000000-0000-0000-0000-000000000001",
  "10000000-0000-0000-0000-000000000002",
  "10000000-0000-0000-0000-000000000003",
  "10000000-0000-0000-0000-000000000004",
  "10000000-0000-0000-0000-000000000005",
];

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

  await prisma.user.createMany({
    data: [
      { id: ALICE_ID, cognitoId: ALICE_COGNITO_ID, username: "alice", email: "alice@local" },
      { id: BOB_ID, cognitoId: BOB_COGNITO_ID, username: "bob", email: "bob@local" },
      { id: CAROL_ID, cognitoId: CAROL_COGNITO_ID, username: "carol", email: "carol@local" },
    ],
  });

  // alice↔bob accepted friendship
  await prisma.friendship.create({
    data: {
      requesterId: ALICE_ID,
      addresseeId: BOB_ID,
      status: "accepted",
    },
  });

  // carol→alice pending request
  await prisma.friendship.create({
    data: {
      requesterId: CAROL_ID,
      addresseeId: ALICE_ID,
      status: "pending",
    },
  });

  const canyons = [
    { id: CANYON_IDS[0], name: "Grand Canyon", latitude: -33.6392, longitude: 150.2656, numAbseils: 4, longestAbseil: 30, vGrade: 3, aGrade: 2, commitment: 2 },
    { id: CANYON_IDS[1], name: "Claustral Canyon", latitude: -33.5123, longitude: 150.5432, numAbseils: 6, longestAbseil: 45, vGrade: 4, aGrade: 3, commitment: 3 },
    { id: CANYON_IDS[2], name: "Empress Falls", latitude: -33.7345, longitude: 150.4123, numAbseils: 2, longestAbseil: 18, vGrade: 2, aGrade: 1, commitment: 1 },
    { id: CANYON_IDS[3], name: "Slot Canyon", latitude: -33.6789, longitude: 150.3456, numAbseils: 3, longestAbseil: 25, vGrade: 3, aGrade: 2, commitment: 2 },
    { id: CANYON_IDS[4], name: "Deep Pass", latitude: -33.7123, longitude: 150.2890, numAbseils: 5, longestAbseil: 38, vGrade: 4, aGrade: 2, commitment: 3 },
  ];

  for (const canyon of canyons) {
    await prisma.canyon.create({ data: { ...canyon, ownerId: ALICE_ID } });
  }

  // Share first 2 canyons with bob
  await prisma.canyonShare.createMany({
    data: [
      { canyonId: CANYON_IDS[0], sharedById: ALICE_ID, sharedWithId: BOB_ID },
      { canyonId: CANYON_IDS[1], sharedById: ALICE_ID, sharedWithId: BOB_ID },
    ],
  });

  // One trip log per canyon
  for (let i = 0; i < canyons.length; i++) {
    await prisma.tripLog.create({
      data: {
        canyonId: CANYON_IDS[i],
        userId: ALICE_ID,
        date: new Date(`2024-0${i + 1}-15`),
        notes: `Trip ${i + 1} notes`,
      },
    });
  }

  console.log("Seed complete: 3 users, 5 canyons, 2 shares, 5 trip logs");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
