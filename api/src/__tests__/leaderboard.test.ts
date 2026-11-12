import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { throttleWrites } from "./_rateLimitGate";
import {
  API_URL,
  ALICE_ID,
  ALICE_SUB,
  BOB_ID,
  BOB_SUB,
  CAROL_ID,
  as,
} from "./_actors";

// The friends leaderboard's consent boundary. Seed: alice<->bob and bob<->carol
// accepted, carol->alice pending; alice and bob have joined, so the file starts
// by taking both off (the baseline sweep puts them back). Counts are not
// asserted: the seed dates its season trips by the day it ran, and
// computeLeaderboard's shared tests own the arithmetic.
//
// Mutations that turn it red: default `leaderboardOptIn` to true; return the
// board to someone who has not joined; spread the friend's user row into an
// entry.

// `join` waits out the per-user PATCH limit (~61 s) when an earlier file spent
// it, as placeTypes.test.ts does.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

async function join(sub: string, leaderboardOptIn: boolean) {
  const send = () =>
    request(API_URL).patch("/users/me").set(as(sub)).send({ leaderboardOptIn });
  const first = await send();
  const res = (await throttleWrites(first)) ? await send() : first;
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const board = (sub: string) =>
  request(API_URL).get("/friends/leaderboard").set(as(sub));

const ids = (res: { body: { entries: { userId: string }[] } }) =>
  res.body.entries.map((entry) => entry.userId);

beforeAll(async () => {
  await join(ALICE_SUB, false);
  await join(BOB_SUB, false);
});

describe("GET /friends/leaderboard", () => {
  it("tells someone who hasn't joined only that", async () => {
    const res = await board(ALICE_SUB);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ joined: false });
  });

  it("keeps a friend who hasn't joined off the board, naming them in the nudge", async () => {
    await join(ALICE_SUB, true);
    const res = await board(ALICE_SUB);
    expect(res.body.joined).toBe(true);
    expect(ids(res)).toEqual([ALICE_ID]);
    expect(res.body.notJoined).toEqual(["bob"]);
    // Bob, who hasn't joined, still sees nothing of alice's.
    expect((await board(BOB_SUB)).body).toEqual({ joined: false });
  });

  it("shows friends who joined, never a pending requester, and only usernames and counts", async () => {
    await join(BOB_SUB, true);
    const res = await board(ALICE_SUB);
    expect(ids(res).sort()).toEqual([ALICE_ID, BOB_ID].sort());
    expect(ids(res)).not.toContain(CAROL_ID);
    expect(res.body.notJoined).toEqual([]);
    for (const entry of res.body.entries) {
      expect(Object.keys(entry).sort()).toEqual([
        "canyonCount",
        "isSelf",
        "rank",
        "userId",
        "username",
      ]);
    }
    // Seed emails are "<name>@local".
    expect(JSON.stringify(res.body)).not.toContain("@");

    // Bob's board names carol, his friend who hasn't joined.
    expect((await board(BOB_SUB)).body.notJoined).toEqual(["carol"]);
  });

  it("drops someone who leaves from their friends' boards", async () => {
    await join(ALICE_SUB, false);
    expect(ids(await board(BOB_SUB))).toEqual([BOB_ID]);
  });
});
