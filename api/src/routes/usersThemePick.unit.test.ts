// An account that never picked a scheme has no `themeSchemeId` on the wire, so
// a client can tell it from a pick and follow the OS; saving another preference
// must not store the default as a pick either.
//
// Mutation: switch users.ts back to `normalizeUserUiPreferences`: the GET and
// the PATCH cases go red.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ uiPreferences: {} as unknown }));
const update = vi.hoisted(() => vi.fn());

const row = () => ({
  id: "user-1",
  subject: "sub-1",
  email: "a@example.com",
  storageUsedBytes: 0n,
  storageQuotaBytes: 0n,
  uiPreferences: stored.uiPreferences,
  monthlyComputeCredits: 0,
});

vi.mock("../lib/env", () => ({ getEnv: () => process.env }));
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { sub: "sub-1", email: "a@example.com", username: "a" };
    next();
  },
}));
vi.mock("../middleware/rateLimit", () => ({
  userPatchLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
  usernameCheckLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../lib/computeCredits", () => ({
  getMonthlyCreditUsage: async () => ({ quota: 0, used: 0, resetAt: null }),
}));
vi.mock("../lib/egressQuota", () => ({
  getEgressUsage: async () => ({ quota: 0n, used: 0n, resetAt: null }),
}));
vi.mock("../lib/customFieldDefs", () => ({
  defsForUserResponse: async () => ({}),
}));
vi.mock("../services/prisma", () => ({
  default: { user: { findUnique: async () => row(), update } },
}));

import { errorHandler } from "../middleware/errorHandler";
import usersRouter from "./users";

const app = express();
app.use(express.json());
app.use("/users", usersRouter);
app.use(errorHandler);

beforeEach(() => {
  stored.uiPreferences = {};
  update.mockReset().mockImplementation(async ({ data }) => ({
    ...row(),
    ...data,
  }));
});

describe("GET /users/me", () => {
  it("leaves themeSchemeId out when the account never picked one", async () => {
    const res = await request(app).get("/users/me");
    expect(res.status).toBe(200);
    expect(res.body.uiPreferences).not.toHaveProperty("themeSchemeId");
    expect(res.body.uiPreferences.notifications).toBeTruthy();
  });

  it("returns a stored pick", async () => {
    stored.uiPreferences = { themeSchemeId: "basalt" };
    const res = await request(app).get("/users/me");
    expect(res.body.uiPreferences.themeSchemeId).toBe("basalt");
  });
});

describe("PATCH /users/me", () => {
  it("does not store the default scheme when another preference changes", async () => {
    const res = await request(app)
      .patch("/users/me")
      .send({ leaderboardOptIn: true });
    expect(res.status).toBe(200);
    const written = update.mock.calls[0][0].data.uiPreferences;
    expect(written).not.toHaveProperty("themeSchemeId");
    expect(res.body.uiPreferences).not.toHaveProperty("themeSchemeId");
  });

  it("stores a pick, and keeps one through another change", async () => {
    await request(app).patch("/users/me").send({ themeSchemeId: "ghostGum" });
    expect(update.mock.calls[0][0].data.uiPreferences.themeSchemeId).toBe(
      "ghostGum",
    );
    stored.uiPreferences = { themeSchemeId: "ghostGum" };
    await request(app).patch("/users/me").send({ leaderboardOptIn: true });
    expect(update.mock.calls[1][0].data.uiPreferences.themeSchemeId).toBe(
      "ghostGum",
    );
  });
});
