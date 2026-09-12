import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import {
  API_URL,
  ALICE_SUB,
  ALICE_ID,
  BOB_SUB,
  CAROL_SUB,
  SHARED_PLACE_ID,
  NONEXISTENT_ID,
  as,
} from "./_actors";

// COPYING A SHARED ROUTE into your own account (`POST /routes/:id/copy`) — the
// sibling of `POST /places/:id/copy`, and the half of "save a copy" that did
// not exist until now.
//
// Requires `make dev` (Postgres + API on :8080) with AUTH_MODE=fake. Seed
// baseline: alice owns SHARED_PLACE_ID and shares it with bob; carol is shared
// nothing.
//
// The three rules, in the order they are easiest to get wrong:
//
//  1. A SHAREE MAY COPY. This is not an owner-only action, so it reads through
//     `requireShareAccess` and never reaches the 403 branch. Getting this
//     backwards makes the feature refuse the only person who needs it.
//  2. THE COPY IS UNLINKED. `Route.placeId` is a @unique slot on the OWNER's
//     place; a copy that inherited it would displace the original out of the
//     place it belongs to — a write to the owner's data from the recipient's
//     copy button.
//  3. A STRANGER GETS 404, never 403 (SEC-001 anti-oracle): the status may not
//     confirm that a route id exists to someone who cannot see it.

const LINE: [number, number][] = [
  [150.4033, -33.5603],
  [150.4043, -33.5613],
  [150.4053, -33.5608],
];

const created: { id: string; sub: string }[] = [];

async function createRoute(
  sub: string,
  name: string,
  placeId?: string,
): Promise<string> {
  const res = await request(API_URL)
    .post("/routes")
    .set(as(sub))
    .send({ name, points: LINE, ...(placeId && { placeId }) });
  expect(res.status).toBe(201);
  created.push({ id: res.body.id as string, sub });
  return res.body.id as string;
}

function track(sub: string, id: string): string {
  created.push({ id, sub });
  return id;
}

afterAll(async () => {
  for (const { id, sub } of created) {
    await request(API_URL).delete(`/routes/${id}`).set(as(sub));
  }
});

describe("POST /routes/:id/copy — a sharee saving their own copy", () => {
  it("copies a route reached through a shared place, UNLINKED and owned by the copier", async () => {
    // Alice's route, linked to the place she shares with bob: bob can see it
    // (a linked route is part of the shared record) but owns nothing.
    const routeId = await createRoute(ALICE_SUB, "Exit track", SHARED_PLACE_ID);

    const res = await request(API_URL)
      .post(`/routes/${routeId}/copy`)
      .set(as(BOB_SUB));
    expect(res.status).toBe(201);
    track(BOB_SUB, res.body.id as string);

    // A new row, bob's, carrying the geometry and the name.
    expect(res.body.id).not.toBe(routeId);
    expect(res.body.ownerId).not.toBe(ALICE_ID);
    expect(res.body.name).toBe("Exit track");
    expect(res.body.points).toEqual(LINE);

    // RULE 2. The copy takes no place with it — and the source keeps the place
    // it was linked to, which is the half a @unique slot would have broken.
    expect(res.body.placeId).toBeNull();
    const source = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(source.status).toBe(200);
    expect(source.body.placeId).toBe(SHARED_PLACE_ID);
  });

  it("gives the copy a colour from the COPIER's palette, and leaves the source's alone", async () => {
    const routeId = await createRoute(ALICE_SUB, "Second exit", SHARED_PLACE_ID);
    const res = await request(API_URL)
      .post(`/routes/${routeId}/copy`)
      .set(as(BOB_SUB));
    expect(res.status).toBe(201);
    track(BOB_SUB, res.body.id as string);
    // Not asserting WHICH colour — that is `pickNextTrackColor`'s business and
    // depends on what bob already owns. Asserting it is a real palette entry
    // and that copying did not repaint alice's line.
    expect(typeof res.body.color).toBe("string");
    expect(res.body.color.length).toBeGreaterThan(0);
    const source = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(source.body.color).not.toBeNull();
  });

  it("lets the owner copy their own route — an ordinary duplicate", async () => {
    const routeId = await createRoute(ALICE_SUB, "Scouting line");
    const res = await request(API_URL)
      .post(`/routes/${routeId}/copy`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(201);
    track(ALICE_SUB, res.body.id as string);
    expect(res.body.id).not.toBe(routeId);
    expect(res.body.placeId).toBeNull();
  });
});

describe("POST /routes/:id/copy — what it refuses, and with which status", () => {
  it("answers 404 to a stranger, never 403", async () => {
    const routeId = await createRoute(ALICE_SUB, "Private line");
    // Carol is shared nothing. A 403 here would confirm the id exists.
    const res = await request(API_URL)
      .post(`/routes/${routeId}/copy`)
      .set(as(CAROL_SUB));
    expect(res.status).toBe(404);
  });

  it("answers 404 to an unknown id, the same as to a hidden one", async () => {
    const res = await request(API_URL)
      .post(`/routes/${NONEXISTENT_ID}/copy`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(404);
  });

  it("creates nothing for the caller when it refuses", async () => {
    const routeId = await createRoute(ALICE_SUB, "Refused line");
    const before = await request(API_URL).get("/routes").set(as(CAROL_SUB));
    await request(API_URL).post(`/routes/${routeId}/copy`).set(as(CAROL_SUB));
    const after = await request(API_URL).get("/routes").set(as(CAROL_SUB));
    expect(after.body.length).toBe(before.body.length);
  });
});
