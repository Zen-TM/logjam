import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import prisma from "../services/prisma";
import { API_URL, as, ALICE_ID, BOB_ID, BOB_SUB } from "./_actors";

// Integration coverage for routes/devices.ts. Requires `make dev`
// (AUTH_MODE=fake; no header = alice). No unauthenticated-401 case: fake auth
// accepts a missing header as alice, so requireAuth's rejection is only
// reachable under real Cognito.
const AUTH = { Authorization: "Bearer fake-token" } as const;
const TOKEN = `ExponentPushToken[devices-test-${Date.now()}]`;

afterEach(async () => {
  await prisma.deviceToken.deleteMany({ where: { token: TOKEN } });
});

const owner = async () =>
  (await prisma.deviceToken.findMany({ where: { token: TOKEN } })).map(
    (d) => d.userId,
  );

describe("device tokens", () => {
  it("rejects a bad token or platform with 400", async () => {
    for (const body of [
      { token: "", platform: "ios" },
      { token: "x".repeat(513), platform: "ios" },
      { token: TOKEN, platform: "windows" },
      { platform: "ios" },
    ]) {
      const res = await request(API_URL).post("/devices").set(AUTH).send(body);
      expect(res.status).toBe(400);
    }
  });

  it("register is idempotent: the same token twice leaves one row", async () => {
    const send = () =>
      request(API_URL)
        .post("/devices")
        .set(AUTH)
        .send({ token: TOKEN, platform: "android" });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await owner()).toEqual([ALICE_ID]);
  });

  it("a token re-registered by a second user moves to that user", async () => {
    await request(API_URL)
      .post("/devices")
      .set(AUTH)
      .send({ token: TOKEN, platform: "ios" });
    const res = await request(API_URL)
      .post("/devices")
      .set(as(BOB_SUB))
      .send({ token: TOKEN, platform: "ios" });
    expect(res.status).toBe(201);
    expect(await owner()).toEqual([BOB_ID]);
  });

  it("delete removes only the caller's token, and answers 204 either way", async () => {
    await request(API_URL)
      .post("/devices")
      .set(as(BOB_SUB))
      .send({ token: TOKEN, platform: "ios" });
    // Mutation: drop `userId` from the deleteMany where and alice deletes bob's.
    const foreign = await request(API_URL)
      .delete(`/devices/${encodeURIComponent(TOKEN)}`)
      .set(AUTH);
    expect(foreign.status).toBe(204);
    expect(await owner()).toEqual([BOB_ID]);

    const own = await request(API_URL)
      .delete(`/devices/${encodeURIComponent(TOKEN)}`)
      .set(as(BOB_SUB));
    expect(own.status).toBe(204);
    expect(await owner()).toEqual([]);
  });
});
