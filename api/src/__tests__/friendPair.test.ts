import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import prisma from "../services/prisma";
import { API_URL, BOB_ID, BOB_SUB, CAROL_ID, CAROL_SUB, as } from "./_actors";

// Two people get one friendship row, whichever of them asked and however
// close together they asked. Requires `make dev`.
//
// The seed leaves no two actors strangers, so each test first removes
// whatever is between BOB and CAROL, straight from the table; the sweep after
// the file (_seedBaseline.ts) puts the seeded row back.
//
// Mutations that turn it red: drop the `friendships_pair_key` index
// (migration 20261012120000_friendships_one_per_pair) and the reciprocal
// insert is accepted; drop the second attempt in POST /friends/request or
// POST /friends/invites/redeem and a race that interleaves answers 500;
// answer an opposite pending request with a 409 and the two never become
// friends by asking.

const betweenBobAndCarol = {
  OR: [
    { requesterId: BOB_ID, addresseeId: CAROL_ID },
    { requesterId: CAROL_ID, addresseeId: BOB_ID },
  ],
};

const requestFriend = (sub: string, addresseeId: string) =>
  request(API_URL).post("/friends/request").set(as(sub)).send({ addresseeId });

describe("one friendship per pair", () => {
  beforeEach(async () => {
    await prisma.friendship.deleteMany({ where: betweenBobAndCarol });
  });

  it("refuses a second row the other way round", async () => {
    await prisma.friendship.create({
      data: { requesterId: BOB_ID, addresseeId: CAROL_ID },
    });
    await expect(
      prisma.friendship.create({
        data: { requesterId: CAROL_ID, addresseeId: BOB_ID },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("makes friends of two people who ask each other at once", async () => {
    const answers = await Promise.all([
      requestFriend(BOB_SUB, CAROL_ID),
      requestFriend(CAROL_SUB, BOB_ID),
    ]);
    // One made the request, the other accepted it, whichever landed first.
    expect(answers.map((res) => res.status).sort()).toEqual([200, 201]);
    const rows = await prisma.friendship.findMany({
      where: betweenBobAndCarol,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("accepted");
  });

  // Mutation that turns it red: scope the purge to the requester only, which
  // leaves the addressee's friend_request behind.
  it("unfriending drops the friend_request and friend_request_accepted rows", async () => {
    const friendship = await prisma.friendship.create({
      data: { requesterId: BOB_ID, addresseeId: CAROL_ID, status: "accepted" },
    });
    const payload = { friendshipId: friendship.id };
    await prisma.notification.createMany({
      data: [
        { userId: CAROL_ID, type: "friend_request", payload },
        { userId: BOB_ID, type: "friend_request_accepted", payload },
      ],
    });
    const res = await request(API_URL)
      .delete(`/friends/${friendship.id}`)
      .set(as(BOB_SUB));
    expect(res.status).toBe(204);
    expect(
      await prisma.notification.count({
        where: { payload: { path: ["friendshipId"], equals: friendship.id } },
      }),
    ).toBe(0);
  });

  it("accepts a waiting request when its addressee asks back", async () => {
    const first = await requestFriend(BOB_SUB, CAROL_ID);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe("pending");
    // Asking twice the same way is still refused.
    expect((await requestFriend(BOB_SUB, CAROL_ID)).status).toBe(409);

    const back = await requestFriend(CAROL_SUB, BOB_ID);
    expect(back.status).toBe(200);
    // The row an older build already reads, now accepted: same id, same
    // fields, and `updatedAt` moved for the delta pull.
    expect(Object.keys(back.body).sort()).toEqual(
      Object.keys(first.body).sort(),
    );
    expect(back.body).toMatchObject({
      id: first.body.id,
      requesterId: BOB_ID,
      addresseeId: CAROL_ID,
      status: "accepted",
    });
    expect(Date.parse(back.body.updatedAt)).toBeGreaterThan(
      Date.parse(first.body.updatedAt),
    );

    // Carol's prompt went; bob, who asked first, is told as by any accept.
    const about = await prisma.notification.findMany({
      where: { payload: { path: ["friendshipId"], equals: first.body.id } },
      select: { userId: true, type: true },
    });
    expect(about).toEqual([
      { userId: BOB_ID, type: "friend_request_accepted" },
    ]);
    const friends = await request(API_URL).get("/friends").set(as(CAROL_SUB));
    expect(friends.body.some((row: { id: string }) => row.id === BOB_ID)).toBe(
      true,
    );
  });

  it("makes friends of a link spent while its opener's request is sent", async () => {
    const minted = await request(API_URL)
      .post("/friends/invites")
      .set(as(CAROL_SUB));
    expect(minted.status).toBe(201);

    const [spent, asked] = await Promise.all([
      request(API_URL)
        .post("/friends/invites/redeem")
        .set(as(BOB_SUB))
        .send({ token: minted.body.token }),
      requestFriend(BOB_SUB, CAROL_ID),
    ]);
    // The link wins whichever write lands first; the request either made the
    // row the link then accepted, or was told about the one already there.
    expect(spent.status).toBe(200);
    expect([201, 409]).toContain(asked.status);
    const rows = await prisma.friendship.findMany({
      where: betweenBobAndCarol,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(spent.body.friendshipId);
    expect(rows[0].status).toBe("accepted");
  });
});
