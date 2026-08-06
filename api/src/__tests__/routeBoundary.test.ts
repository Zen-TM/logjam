import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import {
  API_URL,
  ALICE_SUB,
  BOB_SUB,
  CAROL_SUB,
  SHARED_CANYON_ID,
  as,
} from "./_actors";

// Route visibility boundary, from the RECIPIENT and STRANGER sides.
//
// Requires `make dev` (Postgres + API on :8080) with AUTH_MODE=fake. Seed
// baseline: alice owns SHARED_CANYON_ID and shares it with bob; carol is
// shared nothing.
//
// The rule under test: a route follows canyon-level MEDIA visibility, not the
// owner-private waypoint rule.
//   - unlinked route            → owner-private, invisible to everyone else;
//   - linked to a shared canyon → visible to the sharee, READ-ONLY;
//   - unlinked again            → sharee visibility is revoked with NO delete
//                                 anywhere, so only a tombstone carries it.
// Every test cleans up the routes it creates so the seed is left intact.

const LINE: [number, number][] = [
  [150.4033, -33.5603],
  [150.4043, -33.5613],
  [150.4053, -33.5608],
];

const created: { id: string; sub: string }[] = [];

async function createRoute(
  sub: string,
  name: string,
  canyonId?: string,
): Promise<string> {
  const res = await request(API_URL)
    .post("/routes")
    .set(as(sub))
    .send({ name, points: LINE, ...(canyonId && { canyonId }) });
  expect(res.status).toBe(201);
  created.push({ id: res.body.id as string, sub });
  return res.body.id as string;
}

afterAll(async () => {
  for (const { id, sub } of created) {
    await request(API_URL).delete(`/routes/${id}`).set(as(sub));
  }
});

describe("route visibility — unlinked routes are owner-private", () => {
  it("owner sees it; a sharee and a stranger get 404, not 403", async () => {
    const routeId = await createRoute(ALICE_SUB, "Unlinked scouting line");

    const owner = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(owner.status).toBe(200);
    expect(owner.body.points).toHaveLength(3);

    // 404 not 403: the status must not confirm the route exists (SEC-001).
    for (const sub of [BOB_SUB, CAROL_SUB]) {
      const res = await request(API_URL).get(`/routes/${routeId}`).set(as(sub));
      expect(res.status).toBe(404);
    }
  });

  it("is absent from a non-owner's list", async () => {
    const routeId = await createRoute(ALICE_SUB, "Another unlinked line");
    const bob = await request(API_URL).get("/routes").set(as(BOB_SUB));
    expect(bob.status).toBe(200);
    expect(bob.body.some((r: { id: string }) => r.id === routeId)).toBe(false);
  });
});

describe("route visibility — linked to a shared canyon", () => {
  it("the sharee can read it, and it appears in their list", async () => {
    const routeId = await createRoute(
      ALICE_SUB,
      "Shared approach",
      SHARED_CANYON_ID,
    );

    const bob = await request(API_URL).get(`/routes/${routeId}`).set(as(BOB_SUB));
    expect(bob.status).toBe(200);
    expect(bob.body.points).toHaveLength(3);

    const list = await request(API_URL).get("/routes").set(as(BOB_SUB));
    expect(list.body.some((r: { id: string }) => r.id === routeId)).toBe(true);

    // Carol is shared nothing — the canyon link must not leak to her.
    const carol = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(CAROL_SUB));
    expect(carol.status).toBe(404);
  });

  it("the sharee may NOT edit or delete it (403, not 404 — they can see it)", async () => {
    const routeId = await createRoute(
      ALICE_SUB,
      "Read-only for bob",
      SHARED_CANYON_ID,
    );

    const patch = await request(API_URL)
      .patch(`/routes/${routeId}`)
      .set(as(BOB_SUB))
      .send({ name: "bob was here" });
    expect(patch.status).toBe(403);

    const del = await request(API_URL)
      .delete(`/routes/${routeId}`)
      .set(as(BOB_SUB));
    expect(del.status).toBe(403);

    // A stranger gets 404 for the same calls — no existence oracle.
    const carolPatch = await request(API_URL)
      .patch(`/routes/${routeId}`)
      .set(as(CAROL_SUB))
      .send({ name: "carol was here" });
    expect(carolPatch.status).toBe(404);

    // And the route is untouched.
    const check = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(check.body.name).toBe("Read-only for bob");
  });

  it("unlinking revokes the sharee's access with no delete anywhere", async () => {
    const routeId = await createRoute(
      ALICE_SUB,
      "About to be unlinked",
      SHARED_CANYON_ID,
    );
    expect(
      (await request(API_URL).get(`/routes/${routeId}`).set(as(BOB_SUB))).status,
    ).toBe(200);

    const unlink = await request(API_URL)
      .patch(`/routes/${routeId}`)
      .set(as(ALICE_SUB))
      .send({ canyonId: null });
    expect(unlink.status).toBe(200);
    expect(unlink.body.canyonId).toBeNull();

    // Bob loses it...
    expect(
      (await request(API_URL).get(`/routes/${routeId}`).set(as(BOB_SUB))).status,
    ).toBe(404);
    // ...but alice still has it. Nothing was deleted.
    const alice = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(alice.status).toBe(200);
    expect(alice.body.canyonId).toBeNull();
  });
});

describe("one route per canyon — linking displaces, never destroys", () => {
  it("displaces the incumbent to standalone and names it in the response", async () => {
    const first = await createRoute(ALICE_SUB, "Original approach", SHARED_CANYON_ID);
    const second = await createRoute(ALICE_SUB, "Better approach");

    const link = await request(API_URL)
      .patch(`/routes/${second}`)
      .set(as(ALICE_SUB))
      .send({ canyonId: SHARED_CANYON_ID });
    expect(link.status).toBe(200);
    expect(link.body.canyonId).toBe(SHARED_CANYON_ID);
    // The UI needs the displaced name to say which route moved.
    expect(link.body.displacedRoute).toEqual({
      id: first,
      name: "Original approach",
    });

    // The incumbent SURVIVES, merely unlinked.
    const incumbent = await request(API_URL)
      .get(`/routes/${first}`)
      .set(as(ALICE_SUB));
    expect(incumbent.status).toBe(200);
    expect(incumbent.body.canyonId).toBeNull();
  });

  it("rejects linking to a canyon the caller does not own", async () => {
    const routeId = await createRoute(BOB_SUB, "Bob's line");
    // Bob can SEE SHARED_CANYON_ID (alice shares it) but does not own it, so
    // the association must be refused.
    const res = await request(API_URL)
      .patch(`/routes/${routeId}`)
      .set(as(BOB_SUB))
      .send({ canyonId: SHARED_CANYON_ID });
    expect(res.status).toBe(400);
  });
});

describe("route payload validation", () => {
  it("rejects a route with fewer than two points", async () => {
    const res = await request(API_URL)
      .post("/routes")
      .set(as(ALICE_SUB))
      .send({ name: "Too short", points: [[150.4, -33.5]] });
    expect(res.status).toBe(400);
  });

  it("rejects an over-cap route and never echoes a coordinate", async () => {
    const tooMany = Array.from({ length: 1001 }, (_, i) => [
      150.4 + i * 0.00001,
      -33.56,
    ]);
    const res = await request(API_URL)
      .post("/routes")
      .set(as(ALICE_SUB))
      .send({ name: "Too many", points: tooMany });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("150.4");
  });

  it("strips a third elevation element rather than storing it", async () => {
    const res = await request(API_URL)
      .post("/routes")
      .set(as(ALICE_SUB))
      .send({
        name: "With elevation",
        points: [
          [150.4033, -33.5603, 812],
          [150.4043, -33.5613, 795],
        ],
      });
    expect(res.status).toBe(201);
    created.push({ id: res.body.id as string, sub: ALICE_SUB });
    expect(res.body.points).toEqual([
      [150.4033, -33.5603],
      [150.4043, -33.5613],
    ]);
  });
});
