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
// insert is accepted; drop the P2002 handling in POST /friends/request or
// POST /friends/invites/redeem and a race that interleaves answers 500.

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

  it("gives two people who ask each other at once one request", async () => {
    const answers = await Promise.all([
      requestFriend(BOB_SUB, CAROL_ID),
      requestFriend(CAROL_SUB, BOB_ID),
    ]);
    expect(answers.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await prisma.friendship.count({ where: betweenBobAndCarol })).toBe(
      1,
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
