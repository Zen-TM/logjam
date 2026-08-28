import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, ALICE_SUB, BOB_SUB, CAROL_SUB, BOB_ID, as } from "./_actors";

// Direct per-item sharing (Share model + /shares) from the RECIPIENT's side —
// the perspective mocked-Prisma unit tests structurally cannot reach, and the
// sibling of shareBoundary.test.ts for canyons.
//
// Requires `make dev`. Seed baseline: alice and bob are friends; carol is a
// stranger to alice's items. Synthetic coords only.

const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

/** Create a throwaway unlinked route owned by `sub`. */
async function createRoute(sub: string, name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/routes")
    .set(as(sub))
    .send({
      name,
      points: [
        [150.1, -33.1],
        [150.2, -33.2],
      ],
    });
  expect(res.status).toBe(201);
  return res.body.id;
}

async function share(sub: string, entityId: string, sharedWithUserId: string) {
  return request(API_URL)
    .post("/shares")
    .set(as(sub))
    .send({ entityType: "route", entityId, sharedWithUserId });
}

describe("POST /shares — grant", () => {
  it("lets the owner share an UNLINKED route with a friend", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-grant");
    const res = await share(ALICE_SUB, routeId, BOB_ID);
    expect(res.status).toBe(201);
    expect(res.body.entityType).toBe("route");
    expect(res.body.entityId).toBe(routeId);
  });

  it("409s on a duplicate rather than creating a second row", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-dup");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(409);
  });

  it("404s for a stranger — never 403, which would confirm the id exists", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-oracle");
    const res = await share(CAROL_SUB, routeId, BOB_ID);
    expect(res.status).toBe(404);
  });
});

describe("recipient view", () => {
  it("a directly-shared route becomes readable, and is marked read-only", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-read");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);

    const res = await request(API_URL).get(`/routes/${routeId}`).set(as(BOB_SUB));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(routeId);

    const list = await request(API_URL).get("/routes").set(as(BOB_SUB));
    expect(list.status).toBe(200);
    expect(list.body.map((r: { id: string }) => r.id)).toContain(routeId);
  });

  it("the delta carries it with syncRole 'shared'", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-delta");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);

    const res = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor: "" })
      .set(as(BOB_SUB))
      .set(CLIENT);
    expect(res.status).toBe(200);
    const row = res.body.changes.routes.find(
      (r: { id: string }) => r.id === routeId,
    );
    expect(row).toBeDefined();
    // The whole point of the grant-side updatedAt bump: without it the row is
    // absent from the recipient's next page until the owner happens to edit it.
    expect(row.syncRole).toBe("shared");
  });

  it("a recipient may NOT edit or delete it (403, not 404 — they can see it)", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-readonly");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);

    const patch = await request(API_URL)
      .patch(`/routes/${routeId}`)
      .set(as(BOB_SUB))
      .send({ name: "renamed by recipient" });
    expect(patch.status).toBe(403);

    const del = await request(API_URL)
      .delete(`/routes/${routeId}`)
      .set(as(BOB_SUB));
    expect(del.status).toBe(403);
  });

  it("a recipient cannot enumerate co-recipients", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-corecipients");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);
    const res = await request(API_URL)
      .get(`/shares/route/${routeId}`)
      .set(as(BOB_SUB));
    expect(res.status).toBe(403);
  });

  it("a stranger sees 404 on the shared route, not 403", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-stranger");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);
    const res = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(CAROL_SUB));
    expect(res.status).toBe(404);
  });
});

describe("GET /shares/:entityType/:entityId — owner's recipient list", () => {
  it("lists recipients by username and never leaks an email", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-list");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);
    const res = await request(API_URL)
      .get(`/shares/route/${routeId}`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].sharedWith.username).toBeTruthy();
    expect(res.body[0].sharedWith).not.toHaveProperty("email");
    expect(JSON.stringify(res.body)).not.toContain("@");
  });
});

describe("DELETE /shares/... — revoke", () => {
  it("revokes, and the recipient loses read access", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-revoke");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);

    const res = await request(API_URL)
      .delete(`/shares/route/${routeId}/${BOB_ID}`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(204);

    const after = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(BOB_SUB));
    expect(after.status).toBe(404);
  });

  it("emits a tombstone so the recipient's mirror drops the row", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-tombstone");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);

    // Cursor AFTER the grant, so the pull below sees only the revoke.
    const before = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor: "" })
      .set(as(BOB_SUB))
      .set(CLIENT);
    const cursor = before.body.cursor;

    expect(
      (
        await request(API_URL)
          .delete(`/shares/route/${routeId}/${BOB_ID}`)
          .set(as(ALICE_SUB))
      ).status,
    ).toBe(204);

    const after = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor })
      .set(as(BOB_SUB))
      .set(CLIENT);
    expect(after.status).toBe(200);
    expect(after.body.tombstones).toContainEqual({
      type: "route",
      id: routeId,
    });
  });

  it("lets the RECIPIENT remove their own access via 'me'", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-self-revoke");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);
    const res = await request(API_URL)
      .delete(`/shares/route/${routeId}/me`)
      .set(as(BOB_SUB));
    expect(res.status).toBe(204);
  });

  it("404s a third party trying to revoke someone else's share", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-third-party");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);
    const res = await request(API_URL)
      .delete(`/shares/route/${routeId}/${BOB_ID}`)
      .set(as(CAROL_SUB));
    expect(res.status).toBe(404);
  });
});

describe("delete cascade", () => {
  it("deleting the route drops its Share rows and tombstones the recipient", async () => {
    const routeId = await createRoute(ALICE_SUB, "direct-share-cascade");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);

    const before = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor: "" })
      .set(as(BOB_SUB))
      .set(CLIENT);
    const cursor = before.body.cursor;

    expect(
      (await request(API_URL).delete(`/routes/${routeId}`).set(as(ALICE_SUB)))
        .status,
    ).toBe(204);

    const after = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor })
      .set(as(BOB_SUB))
      .set(CLIENT);
    expect(after.body.tombstones).toContainEqual({
      type: "route",
      id: routeId,
    });

    // Share rows are polymorphic (no FK), so this is the assertion that the
    // explicit deleteSharesFor call actually ran: a re-created id must not
    // inherit the dead share.
    const list = await request(API_URL).get("/routes").set(as(BOB_SUB));
    expect(list.body.map((r: { id: string }) => r.id)).not.toContain(routeId);
  });
});

// A route can be visible to a recipient for TWO reasons — a direct Share row,
// or a link to a canyon shared with them. Revoking the direct arm must not
// tombstone a recipient who keeps the canyon arm (finding 2), and must still
// re-deliver the row to the OWNER so their other devices refresh sharedCount
// (finding 6).
describe("revoke with a surviving canyon arm", () => {
  async function createCanyon(sub: string, name: string): Promise<string> {
    const res = await request(API_URL)
      .post("/canyons")
      .set(as(sub))
      .send({ name, latitude: -33.7, longitude: 150.3 });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function createLinkedRoute(
    sub: string,
    name: string,
    canyonId: string,
  ): Promise<string> {
    const res = await request(API_URL)
      .post("/routes")
      .set(as(sub))
      .send({
        name,
        points: [
          [150.1, -33.1],
          [150.2, -33.2],
        ],
        canyonId,
      });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("does not tombstone a recipient who still sees the route through a shared canyon", async () => {
    const canyonId = await createCanyon(ALICE_SUB, "revoke guard canyon");
    try {
      const canyonShare = await request(API_URL)
        .post(`/canyons/${canyonId}/share`)
        .set(as(ALICE_SUB))
        .send({ sharedWithUserId: BOB_ID });
      expect(canyonShare.status).toBe(201);

      const routeId = await createLinkedRoute(
        ALICE_SUB,
        "linked + direct",
        canyonId,
      );
      // Direct share layered on top of the canyon inheritance.
      expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);

      const before = await request(API_URL)
        .get("/sync/delta")
        .query({ cursor: "" })
        .set(as(BOB_SUB))
        .set(CLIENT);
      const cursor = before.body.cursor;

      expect(
        (
          await request(API_URL)
            .delete(`/shares/route/${routeId}/${BOB_ID}`)
            .set(as(ALICE_SUB))
        ).status,
      ).toBe(204);

      const after = await request(API_URL)
        .get("/sync/delta")
        .query({ cursor })
        .set(as(BOB_SUB))
        .set(CLIENT);
      const tombstoned = (after.body.tombstones ?? []).some(
        (t: { type: string; id: string }) =>
          t.type === "route" && t.id === routeId,
      );
      expect(tombstoned).toBe(false);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(as(ALICE_SUB));
    }
  });
});

describe("revoke refreshes the owner's delta", () => {
  it("re-delivers the route so the owner's other devices refresh sharedCount", async () => {
    const routeId = await createRoute(ALICE_SUB, "revoke-refresh");
    expect((await share(ALICE_SUB, routeId, BOB_ID)).status).toBe(201);

    const before = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor: "" })
      .set(as(ALICE_SUB))
      .set(CLIENT);
    const cursor = before.body.cursor;

    expect(
      (
        await request(API_URL)
          .delete(`/shares/route/${routeId}/${BOB_ID}`)
          .set(as(ALICE_SUB))
      ).status,
    ).toBe(204);

    const after = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor })
      .set(as(ALICE_SUB))
      .set(CLIENT);
    const reDelivered = (after.body.changes?.routes ?? []).find(
      (r: { id: string }) => r.id === routeId,
    );
    expect(reDelivered).toBeDefined();
    expect(reDelivered.sharedCount).toBe(0);
  });
});
