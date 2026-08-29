import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import {
  API_URL,
  ALICE_SUB,
  BOB_SUB,
  CAROL_SUB,
  BOB_ID,
  CAROL_ID,
  NONEXISTENT_ID,
  as,
} from "./_actors";

// Revocation, from the side that loses access. Three findings live here:
//
//   APIR-007  unfriending must revoke EVERY share type in both directions
//             (canyon, waypoint, route, topo job, GeoPDF job) plus file sends
//             the recipient has not taken yet — while leaving ACCEPTED sends
//             alone, because those are copies the recipient already owns (D2).
//   APIR-012  a canyon_shared notification must stop resolving the canyon NAME
//             once the share is revoked. The canyon row outlives the share, so
//             the old "does the canyon exist" fallback could never catch this.
//   APIR-013  a foreign notification id answers 404, never 403.
//
// Requires `make dev`. Uses the BOB <-> CAROL friendship (seed.ts) rather than
// alice<->bob, which other files treat as an invariant. The pair is
// re-established by `ensureFriends` both before AND after, so this file is safe
// on a fresh seed, on a stale one, and for whatever runs next.
//
// Synthetic coordinates and names only.

const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="logjam-test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Test</name><trkseg>
    <trkpt lat="-33.1" lon="150.1"><ele>800</ele></trkpt>
    <trkpt lat="-33.2" lon="150.2"><ele>790</ele></trkpt>
  </trkseg></trk>
</gpx>`;

/** Make two users friends if they are not already. Idempotent (mirrors the
 *  helper in fileSends.test.ts — a stale dev DB may lack the seeded row). */
async function ensureFriends(
  requesterSub: string,
  addresseeId: string,
  addresseeSub: string,
): Promise<void> {
  await request(API_URL)
    .post("/friends/request")
    .set(as(requesterSub))
    .set(CLIENT)
    .send({ addresseeId });
  const pending = await request(API_URL)
    .get("/friends/requests")
    .set(as(addresseeSub))
    .set(CLIENT);
  // Fail LOUDLY. This used to `return` on any non-200, so a 429 from the
  // per-IP global limiter turned the whole restore into a silent no-op — the
  // suite still reported green while leaving the seeded bob<->carol friendship
  // deleted for every later run. A restore hook that can quietly not restore is
  // worse than no hook.
  if (pending.status !== 200) {
    throw new Error(
      `ensureFriends: GET /friends/requests returned ${pending.status}, ` +
        `cannot restore the friendship`,
    );
  }
  const incoming = (pending.body.incoming ?? pending.body ?? []) as {
    id: string;
  }[];
  for (const row of incoming) {
    const accept = await request(API_URL)
      .patch(`/friends/${row.id}/accept`)
      .set(as(addresseeSub))
      .set(CLIENT);
    // 200 accepted; 404 means someone else already actioned it, which is fine.
    if (accept.status !== 200 && accept.status !== 404) {
      throw new Error(
        `ensureFriends: accept of ${row.id} returned ${accept.status}`,
      );
    }
  }
  // Assert the postcondition rather than assuming it: this helper exists to
  // leave the graph as it found it, so prove it did.
  if ((await friendshipId(requesterSub, addresseeId)) === null) {
    throw new Error(
      "ensureFriends: friendship still missing after the accept pass",
    );
  }
}

/** The friendship id linking `sub` to `otherId`, or null. */
async function friendshipId(
  sub: string,
  otherId: string,
): Promise<string | null> {
  const res = await request(API_URL).get("/friends").set(as(sub)).set(CLIENT);
  expect(res.status).toBe(200);
  const rows = res.body as { id: string; friendshipId?: string }[];
  const match = rows.find((row) => row.id === otherId);
  return match?.friendshipId ?? null;
}

async function createRoute(sub: string, name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/routes")
    .set(as(sub))
    .set(CLIENT)
    .send({
      name,
      points: [
        [150.31, -33.31],
        [150.32, -33.32],
      ],
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function sendCopy(
  senderSub: string,
  recipientIds: string[],
  filename: string,
): Promise<string> {
  const body = Buffer.from(GPX, "utf8");
  const presign = await request(API_URL)
    .post("/file-sends/presign")
    .set(as(senderSub))
    .set(CLIENT)
    .send({
      filename,
      sizeBytes: body.byteLength,
      sourceKind: "import",
      recipientIds,
    });
  expect(presign.status).toBe(201);
  const { fileSendId, uploadUrl } = presign.body as {
    fileSendId: string;
    uploadUrl: string;
  };
  const put = await fetch(uploadUrl, {
    method: "PUT",
    body,
    headers: { "content-length": String(body.byteLength) },
  });
  expect(put.ok).toBe(true);
  const confirm = await request(API_URL)
    .post(`/file-sends/${fileSendId}/confirm`)
    .set(as(senderSub))
    .set(CLIENT)
    .send({ filename, sourceKind: "import", recipientIds });
  expect(confirm.status).toBe(201);
  return fileSendId;
}

async function inbox(sub: string) {
  const res = await request(API_URL)
    .get("/file-sends/inbox")
    .set(as(sub))
    .set(CLIENT);
  expect(res.status).toBe(200);
  return res.body as { fileSendId: string; status: string }[];
}

describe("unfriend revokes every share type (APIR-007 / decision D2)", () => {
  beforeAll(async () => {
    await ensureFriends(BOB_SUB, CAROL_ID, CAROL_SUB);
  });

  // Leave the friendship graph as we found it, whatever happened above.
  afterAll(async () => {
    await ensureFriends(BOB_SUB, CAROL_ID, CAROL_SUB);
  });

  it("kills a direct route share, a pending file send, and keeps the accepted one", async () => {
    // Bob shares a route with carol, sends her two copies, and she takes one.
    const routeId = await createRoute(BOB_SUB, "unfriend-revoke-route");
    const shared = await request(API_URL)
      .post("/shares")
      .set(as(BOB_SUB))
      .set(CLIENT)
      .send({ entityType: "route", entityId: routeId, sharedWithUserId: CAROL_ID });
    expect(shared.status).toBe(201);
    expect(
      (await request(API_URL).get(`/routes/${routeId}`).set(as(CAROL_SUB))).status,
    ).toBe(200);

    const pendingSendId = await sendCopy(BOB_SUB, [CAROL_ID], "pending-send.gpx");
    const acceptedSendId = await sendCopy(BOB_SUB, [CAROL_ID], "accepted-send.gpx");
    expect(
      (
        await request(API_URL)
          .post(`/file-sends/${acceptedSendId}/accept`)
          .set(as(CAROL_SUB))
          .set(CLIENT)
      ).status,
    ).toBe(200);

    const id = await friendshipId(BOB_SUB, CAROL_ID);
    expect(id).toBeTruthy();
    expect(
      (await request(API_URL).delete(`/friends/${id}`).set(as(BOB_SUB))).status,
    ).toBe(204);

    // Read access is gone, and the denial is a 404 (never 403 — that would
    // confirm the route id still exists to someone who may not see it).
    expect(
      (await request(API_URL).get(`/routes/${routeId}`).set(as(CAROL_SUB))).status,
    ).toBe(404);

    // The Share row is gone too, not merely unreadable — a surviving row grants
    // access to whoever re-friends later, with no re-share.
    const recipients = await request(API_URL)
      .get(`/shares/route/${routeId}`)
      .set(as(BOB_SUB));
    expect(recipients.status).toBe(200);
    expect(recipients.body).toEqual([]);

    // The copy she never took is revoked; the copy she accepted is HERS and
    // stays (it expires on its own within FILE_SEND_TTL_DAYS).
    const carolInbox = await inbox(CAROL_SUB);
    expect(carolInbox.some((row) => row.fileSendId === pendingSendId)).toBe(false);
    expect(carolInbox.some((row) => row.fileSendId === acceptedSendId)).toBe(true);
  });
});

describe("revoked canyon share stops resolving the canyon name (APIR-012)", () => {
  it("drops the recipient's canyon_shared notification once the share is gone", async () => {
    // Alice shares a throwaway canyon with bob, then revokes it. The canyon row
    // survives under alice, so only a live-share check can drop the notification
    // — an existence check on the canyon cannot.
    const canyon = await request(API_URL)
      .post("/canyons")
      .set(as(ALICE_SUB))
      .set(CLIENT)
      .send({ name: "revoke-notification-probe", latitude: -33.4, longitude: 150.4 });
    expect(canyon.status).toBe(201);
    const canyonId = canyon.body.id as string;

    expect(
      (
        await request(API_URL)
          .post(`/canyons/${canyonId}/share`)
          .set(as(ALICE_SUB))
          .set(CLIENT)
          .send({ sharedWithUserId: BOB_ID })
      ).status,
    ).toBe(201);

    const notified = await request(API_URL).get("/notifications").set(as(BOB_SUB));
    expect(notified.status).toBe(200);
    const seen = (notified.body as { type: string; payload: Record<string, unknown> }[]).some(
      (n) => n.type === "canyon_shared" && n.payload.canyonId === canyonId,
    );
    // Only assert the drop below if the grant actually produced a notification
    // (bob may have share notifications disabled in a customised dev DB).
    if (!seen) return;

    expect(
      (
        await request(API_URL)
          .delete(`/canyons/${canyonId}/share/${BOB_ID}`)
          .set(as(ALICE_SUB))
      ).status,
    ).toBe(204);

    const after = await request(API_URL).get("/notifications").set(as(BOB_SUB));
    expect(after.status).toBe(200);
    for (const n of after.body as {
      type: string;
      payload: Record<string, unknown>;
    }[]) {
      if (n.type !== "canyon_shared") continue;
      expect(n.payload.canyonId).not.toBe(canyonId);
      // And in particular the canyon NAME must not have been resolved for it.
      expect(JSON.stringify(n.payload)).not.toContain("revoke-notification-probe");
    }
  });
});

describe("foreign notification ids answer 404, never 403 (APIR-013 / PRIV-105)", () => {
  it("a stranger's notification id is indistinguishable from a missing one", async () => {
    const mine = await request(API_URL).get("/notifications").set(as(ALICE_SUB));
    expect(mine.status).toBe(200);
    const first = (mine.body as { id: string }[])[0];
    if (!first) return; // no seeded notification to probe with

    const foreign = await request(API_URL)
      .patch(`/notifications/${first.id}/read`)
      .set(as(CAROL_SUB));
    const missing = await request(API_URL)
      .patch(`/notifications/${NONEXISTENT_ID}/read`)
      .set(as(CAROL_SUB));
    expect(foreign.status).toBe(404);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body.error).toBe(missing.body.error);

    const foreignDelete = await request(API_URL)
      .delete(`/notifications/${first.id}`)
      .set(as(CAROL_SUB));
    expect(foreignDelete.status).toBe(404);
    // …and the row is still there for its real owner.
    const stillMine = await request(API_URL).get("/notifications").set(as(ALICE_SUB));
    expect((stillMine.body as { id: string }[]).some((n) => n.id === first.id)).toBe(
      true,
    );
  });
});
