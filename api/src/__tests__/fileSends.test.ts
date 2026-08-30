import { beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import {
  API_URL,
  ALICE_SUB,
  BOB_SUB,
  CAROL_SUB,
  ALICE_ID,
  BOB_ID,
  CAROL_ID,
  as,
} from "./_actors";
import prisma from "../services/prisma";

// "Send a copy" (FileSend) from the RECIPIENT's side — the perspective
// mocked-Prisma unit tests structurally cannot reach, and the sibling of
// directShare.test.ts.
//
// The properties worth an integration test are all about MULTIPLE people on ONE
// object, which is exactly where the design nearly went wrong: the obvious
// "delete the bytes when someone responds" strands every other recipient, so
// the gate has to be the recipient's own row and nothing else.
//
// Requires `make dev`. SEED FRIENDSHIP GRAPH (prisma/seed.ts), which decides
// who can appear in these tests at all:
//
//   alice <-> bob    accepted
//   bob   <-> carol  accepted
//   carol  -> alice  PENDING — so alice and carol are NOT friends
//
// BOB is therefore the only actor with two friends, and every multi-recipient
// case below is sent by bob to [alice, carol]. Sending those as alice fails the
// friend check before anything under test runs.
//
// bob<->carol is ESTABLISHED BY THIS FILE rather than assumed, because a dev
// database seeded before that row was added to seed.ts still lacks it (found
// 2026-08-22 on the kiosk box) — and re-seeding to fix a test is a destructive
// answer to a setup problem. `ensureFriends` is idempotent, so the suite is
// correct on a fresh seed and on a stale one alike.
//
// Synthetic content only — never a real canyon name in a filename here.

const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="logjam-test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Test</name><trkseg>
    <trkpt lat="-33.1" lon="150.1"><ele>800</ele></trkpt>
    <trkpt lat="-33.2" lon="150.2"><ele>790</ele></trkpt>
  </trkseg></trk>
</gpx>`;

/**
 * The full three-phase send: presign → PUT the bytes → confirm.
 *
 * The PUT goes to the presigned URL exactly as a phone's would, so this also
 * exercises the ContentLength signed into it — a test that skipped the upload
 * would let a confirm succeed against an object that never existed.
 */
async function sendCopy(
  senderSub: string,
  recipientIds: string[],
  filename = "test-send.gpx",
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

/**
 * Make two users friends if they are not already. Idempotent: a duplicate
 * request or an already-accepted pair is a no-op, never a failure.
 */
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
  if (pending.status !== 200) return;
  const incoming = (pending.body.incoming ?? pending.body ?? []) as {
    id: string;
  }[];
  for (const row of incoming) {
    await request(API_URL)
      .patch(`/friends/${row.id}/accept`)
      .set(as(addresseeSub))
      .set(CLIENT);
  }
}

async function inbox(sub: string) {
  const res = await request(API_URL).get("/file-sends/inbox").set(as(sub)).set(CLIENT);
  expect(res.status).toBe(200);
  return res.body as { fileSendId: string; filename: string; status: string }[];
}

describe("file sends — recipient boundary", () => {
  beforeAll(async () => {
    await ensureFriends(BOB_SUB, CAROL_ID, CAROL_SUB);
  });

  it("reaches every recipient of one send, and nobody else", async () => {
    const id = await sendCopy(BOB_SUB, [ALICE_ID, CAROL_ID]);

    expect((await inbox(ALICE_SUB)).some((row) => row.fileSendId === id)).toBe(true);
    expect((await inbox(CAROL_SUB)).some((row) => row.fileSendId === id)).toBe(true);
    // The sender is not a recipient of their own send.
    expect((await inbox(BOB_SUB)).some((row) => row.fileSendId === id)).toBe(false);
  });

  it("404s a non-recipient's accept — never 403", async () => {
    // 403 would confirm the id exists to someone with no right to know it
    // (the anti-oracle rule in root CLAUDE.md).
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);
    // carol is not on this send at all.
    const res = await request(API_URL)
      .post(`/file-sends/${id}/accept`)
      .set(as(CAROL_SUB))
      .set(CLIENT);
    expect(res.status).toBe(404);
  });

  it("404s an accept on an id that never existed, identically", async () => {
    const res = await request(API_URL)
      .post("/file-sends/00000000-0000-4000-8000-0000000000ff/accept")
      .set(as(BOB_SUB))
      .set(CLIENT);
    expect(res.status).toBe(404);
  });

  // THE BUG THIS WHOLE SHAPE EXISTS TO PREVENT: one S3 object serves every
  // recipient, so a response from one person must not touch anyone else's
  // access. Deleting the bytes on accept (or on decline) was the obvious
  // implementation and would have stranded the others.
  it("leaves a co-recipient able to accept after the first one has", async () => {
    const id = await sendCopy(BOB_SUB, [ALICE_ID, CAROL_ID]);

    const aliceAccept = await request(API_URL)
      .post(`/file-sends/${id}/accept`)
      .set(as(ALICE_SUB))
      .set(CLIENT);
    expect(aliceAccept.status).toBe(200);
    expect(typeof aliceAccept.body.downloadUrl).toBe("string");

    const carolAccept = await request(API_URL)
      .post(`/file-sends/${id}/accept`)
      .set(as(CAROL_SUB))
      .set(CLIENT);
    expect(carolAccept.status).toBe(200);

    // Both URLs must actually serve the bytes — an accept that returns a URL
    // for a deleted object is the failure this test is named for.
    const fetched = await fetch(carolAccept.body.downloadUrl as string);
    expect(fetched.ok).toBe(true);
    expect(await fetched.text()).toContain("<gpx");
  });

  it("refuses a declined recipient while a co-recipient still succeeds", async () => {
    const id = await sendCopy(BOB_SUB, [ALICE_ID, CAROL_ID]);

    const decline = await request(API_URL)
      .post(`/file-sends/${id}/decline`)
      .set(as(ALICE_SUB))
      .set(CLIENT);
    // 204: declining has nothing to hand back, unlike accept's download URL.
    expect(decline.status).toBe(204);

    // 404, not 409: a declined recipient is refused the same way a stranger
    // is, so the status never distinguishes "you turned this down" from "no
    // such send" to anyone reading it afterwards.
    const aliceAfter = await request(API_URL)
      .post(`/file-sends/${id}/accept`)
      .set(as(ALICE_SUB))
      .set(CLIENT);
    expect(aliceAfter.status).toBe(404);

    // Declining is a fact about alice, not about the bytes.
    const carol = await request(API_URL)
      .post(`/file-sends/${id}/accept`)
      .set(as(CAROL_SUB))
      .set(CLIENT);
    expect(carol.status).toBe(200);
  });

  it("lets an accepted recipient download again while the send is live", async () => {
    // Accept flips the row when the URL is ISSUED, not when the transfer
    // succeeds, so a recipient who accepted on a dead connection must be able
    // to ask again. See the Download again affordance in the mobile inbox.
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);
    for (const attempt of [1, 2]) {
      const res = await request(API_URL)
        .post(`/file-sends/${id}/accept`)
        .set(as(BOB_SUB))
        .set(CLIENT);
      expect(res.status, `attempt ${attempt}`).toBe(200);
      expect(typeof res.body.downloadUrl).toBe("string");
    }
  });
});

describe("file sends — sender boundary", () => {
  it("refuses a recipient who is not a friend", async () => {
    // carol's request to alice is still PENDING, so they are not friends.
    const body = Buffer.from(GPX, "utf8");
    const res = await request(API_URL)
      .post("/file-sends/presign")
      .set(as(ALICE_SUB))
      .set(CLIENT)
      .send({
        filename: "test-send.gpx",
        sizeBytes: body.byteLength,
        sourceKind: "import",
        recipientIds: [CAROL_ID],
      });
    expect([400, 403]).toContain(res.status);
  });

  it("refuses an unsendable extension and an oversized declaration", async () => {
    const base = {
      sourceKind: "import" as const,
      recipientIds: [BOB_ID],
    };
    const badExt = await request(API_URL)
      .post("/file-sends/presign")
      .set(as(ALICE_SUB))
      .set(CLIENT)
      .send({ ...base, filename: "notes.txt", sizeBytes: 10 });
    expect(badExt.status).toBe(400);

    const tooBig = await request(API_URL)
      .post("/file-sends/presign")
      .set(as(ALICE_SUB))
      .set(CLIENT)
      .send({ ...base, filename: "huge.gpx", sizeBytes: 512 * 1024 * 1024 });
    expect(tooBig.status).toBe(413);
  });

  it("is idempotent on confirm — a retry does not create a second send", async () => {
    const body = Buffer.from(GPX, "utf8");
    const presign = await request(API_URL)
      .post("/file-sends/presign")
      .set(as(ALICE_SUB))
      .set(CLIENT)
      .send({
        filename: "idempotent.gpx",
        sizeBytes: body.byteLength,
        sourceKind: "import",
        recipientIds: [BOB_ID],
      });
    expect(presign.status).toBe(201);
    const { fileSendId, uploadUrl } = presign.body;
    expect((await fetch(uploadUrl, { method: "PUT", body })).ok).toBe(true);

    const confirmBody = {
      filename: "idempotent.gpx",
      sourceKind: "import",
      recipientIds: [BOB_ID],
    };
    const first = await request(API_URL)
      .post(`/file-sends/${fileSendId}/confirm`)
      .set(as(ALICE_SUB))
      .set(CLIENT)
      .send(confirmBody);
    const second = await request(API_URL)
      .post(`/file-sends/${fileSendId}/confirm`)
      .set(as(ALICE_SUB))
      .set(CLIENT)
      .send(confirmBody);

    expect(first.status).toBe(201);
    // A retried confirm must not charge quota twice; it returns the send it
    // already made rather than erroring.
    expect([200, 201]).toContain(second.status);
    const bobRows = (await inbox(BOB_SUB)).filter(
      (row) => row.fileSendId === fileSendId,
    );
    expect(bobRows).toHaveLength(1);
  });

  it("404s a confirm on somebody else's send id", async () => {
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);
    const res = await request(API_URL)
      .post(`/file-sends/${id}/confirm`)
      .set(as(CAROL_SUB))
      .set(CLIENT)
      .send({ filename: "test-send.gpx", sourceKind: "import", recipientIds: [BOB_ID] });
    expect(res.status).toBe(404);
  });
});

// The `file_sent` notification is what mobile renders Accept / Turn down on
// (there is no "Received files" screen any more), so it has to carry enough to
// answer with — and stop carrying it the moment the answer is no.
describe("file sends — the actionable notification", () => {
  /**
   * Age a send past its TTL. This is what expiry IS — `expiresAt` in the past —
   * so the clock is moved rather than waiting seven days for it. It is also
   * exactly what the accept path's missing-object guard writes when it finds
   * the bytes gone, so both routes into the state are covered by one setup.
   */
  async function expireSend(fileSendId: string) {
    await prisma.fileSend.update({
      where: { id: fileSendId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
  }

  async function fileSentNotifications(sub: string) {
    const res = await request(API_URL).get("/notifications").set(as(sub)).set(CLIENT);
    expect(res.status).toBe(200);
    return (res.body as { type: string; payload: Record<string, unknown> }[]).filter(
      (n) => n.type === "file_sent",
    );
  }

  // The recipient is entitled to know WHAT they are being offered before they
  // accept it — but it is resolved from the live send, never stored in the
  // payload (PRIV-005).
  it("resolves the filename, sender and status onto the recipient's notification", async () => {
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);

    const [notification] = (await fileSentNotifications(BOB_SUB)).filter(
      (n) => n.payload.fileSendId === id,
    );
    expect(notification).toBeDefined();
    expect(notification.payload.filename).toBe("test-send.gpx");
    expect(notification.payload.sentByUsername).toBe("alice");
    expect(notification.payload.fileSendStatus).toBe("pending");
  });

  it("flips the status to accepted, so the row keeps offering the download", async () => {
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);
    const accept = await request(API_URL)
      .post(`/file-sends/${id}/accept`)
      .set(as(BOB_SUB))
      .set(CLIENT);
    expect(accept.status).toBe(200);

    const [notification] = (await fileSentNotifications(BOB_SUB)).filter(
      (n) => n.payload.fileSendId === id,
    );
    // Still there on purpose: "accepted" means the URL was ISSUED, not that the
    // bytes landed, so the retry has to survive.
    expect(notification.payload.fileSendStatus).toBe("accepted");
    expect(notification.payload.filename).toBe("test-send.gpx");
  });

  it("drops the notification, filename and all, once turned down", async () => {
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);
    const decline = await request(API_URL)
      .post(`/file-sends/${id}/decline`)
      .set(as(BOB_SUB))
      .set(CLIENT);
    expect(decline.status).toBe(204);

    const remaining = (await fileSentNotifications(BOB_SUB)).filter(
      (n) => n.payload.fileSendId === id,
    );
    expect(remaining).toHaveLength(0);
  });

  // Expiry is the state nothing covered, and it is the one a recipient meets
  // days later with no other explanation available.
  it("explains a send that lapsed before it was saved, and offers nothing", async () => {
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);
    await expireSend(id);

    // Nothing can be answered any more, and the endpoint says so.
    const accept = await request(API_URL)
      .post(`/file-sends/${id}/accept`)
      .set(as(BOB_SUB))
      .set(CLIENT);
    expect(accept.status).toBe(404);

    const [notification] = (await fileSentNotifications(BOB_SUB)).filter(
      (n) => n.payload.fileSendId === id,
    );
    // Still THERE — the recipient never got the file, so the row has to say
    // why it can no longer be answered rather than silently disappearing.
    expect(notification).toBeDefined();
    expect(notification.payload.fileSendStatus).toBe("expired");
    expect(notification.payload.filename).toBe("test-send.gpx");
    // And gone from the list of things that can be acted on.
    expect((await inbox(BOB_SUB)).map((r) => r.fileSendId)).not.toContain(id);
  });

  // The state AFTER the reaper has been through: the row is gone, so nothing
  // can be resolved from it — the name the recipient sees is the one the sweep
  // stamped into the payload on its way past. Crafted directly here because the
  // reaper's own behaviour is pinned in fileSendReaper.unit.test.ts; what this
  // asserts is the READER's half of that contract.
  it("still names the file after the send itself has been swept", async () => {
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);
    const notification = await prisma.notification.findFirstOrThrow({
      where: {
        userId: BOB_ID,
        type: "file_sent",
        payload: { path: ["fileSendId"], equals: id },
      },
      select: { id: true, payload: true },
    });
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        payload: { ...(notification.payload as object), filename: "test-send.gpx" },
      },
    });
    await prisma.fileSend.delete({ where: { id } });

    const [view] = (await fileSentNotifications(BOB_SUB)).filter(
      (n) => n.payload.fileSendId === id,
    );
    expect(view).toBeDefined();
    expect(view.payload.fileSendStatus).toBe("expired");
    expect(view.payload.filename).toBe("test-send.gpx");
    expect(view.payload.sentByUsername).toBe("alice");
  });

  // A send swept before the stamping existed carries no filename, and the label
  // degrades rather than inventing one.
  it("degrades to a nameless notice when no filename was ever stamped", async () => {
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);
    await prisma.fileSend.delete({ where: { id } });

    const [view] = (await fileSentNotifications(BOB_SUB)).filter(
      (n) => n.payload.fileSendId === id,
    );
    expect(view.payload.fileSendStatus).toBe("expired");
    expect(view.payload.filename).toBeUndefined();
  });

  // The other half of the same rule: someone who already took the copy is not
  // told their download expired, because they have the file.
  it("says nothing to a recipient who had already saved it", async () => {
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);
    const first = await request(API_URL)
      .post(`/file-sends/${id}/accept`)
      .set(as(BOB_SUB))
      .set(CLIENT);
    expect(first.status).toBe(200);

    await expireSend(id);

    const remaining = (await fileSentNotifications(BOB_SUB)).filter(
      (n) => n.payload.fileSendId === id,
    );
    expect(remaining).toHaveLength(0);
  });

  // The notification query is deliberately WIDER than the inbox endpoint — it
  // keeps EXPIRED sends so the row can say so, where the inbox drops them. The
  // invariant is therefore not "the two agree" but the thing that actually
  // matters: anything still ACTIONABLE is something the endpoint would serve.
  it("never offers an action the send endpoint would refuse", async () => {
    const id = await sendCopy(ALICE_SUB, [BOB_ID]);
    await request(API_URL).post(`/file-sends/${id}/decline`).set(as(BOB_SUB)).set(CLIENT);

    const inboxIds = (await inbox(BOB_SUB)).map((row) => row.fileSendId);
    const notified = await fileSentNotifications(BOB_SUB);
    expect(inboxIds).not.toContain(id);
    expect(notified.map((n) => n.payload.fileSendId)).not.toContain(id);
    // Expired rows render no buttons (notificationActions returns null), so
    // they are the one kind allowed to be present and absent from the inbox.
    for (const n of notified.filter((row) => row.payload.fileSendStatus !== "expired")) {
      expect(inboxIds).toContain(n.payload.fileSendId);
    }
  });
});
