// GET /users/me re-points an account at a new subject only when the token's
// email is verified and the provider says the old subject is gone (ADR 0045).
// Anything less hands one person's account to whoever signs up with that email.
//
// Mutations that turn it red: drop the emailVerified check, drop the userExists
// check, or invert it.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const claims = vi.hoisted(() => ({ emailVerified: true }));
const userExists = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const warn = vi.hoisted(() => vi.fn());

const row = vi.hoisted(() => (subject: string) => ({
  id: "user-1",
  subject,
  email: "a@example.com",
  storageUsedBytes: 0n,
  storageQuotaBytes: 0n,
  uiPreferences: {},
  monthlyComputeCredits: 0,
}));

vi.mock("../lib/env", () => ({ getEnv: () => process.env }));
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = {
      sub: "new-sub",
      email: "a@example.com",
      username: "a",
      ...claims,
    };
    next();
  },
}));
vi.mock("../middleware/rateLimit", () => ({
  userPatchLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
  usernameCheckLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../lib/identityProvider", () => ({
  identityProvider: () => ({ userExists }),
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
vi.mock("../lib/logger", async (orig) => ({
  ...(await orig<typeof import("../lib/logger")>()),
  logger: { warn, info: vi.fn(), error: vi.fn() },
}));
vi.mock("../services/prisma", () => ({
  default: {
    user: {
      // By subject: no row for the new one. By email: the old identity's row.
      findUnique: async ({ where }: { where: { email?: string } }) =>
        where.email ? row("old-sub") : null,
      update,
    },
  },
}));

import { errorHandler } from "../middleware/errorHandler";
import usersRouter from "./users";

const app = express();
app.use("/users", usersRouter);
app.use(errorHandler);

beforeEach(() => {
  claims.emailVerified = true;
  userExists.mockReset().mockResolvedValue(false);
  update.mockReset().mockResolvedValue(row("new-sub"));
  warn.mockReset();
});

describe("GET /users/me for a new subject with a taken email", () => {
  it("re-points the account when the email is verified and the old subject is gone", async () => {
    const res = await request(app).get("/users/me");
    expect(res.status).toBe(200);
    expect(userExists).toHaveBeenCalledWith("old-sub");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } }),
    );
    expect(warn).toHaveBeenCalledWith(expect.anything(), "identity_rebind");
  });

  it("refuses while the old subject still exists", async () => {
    userExists.mockResolvedValue(true);
    const res = await request(app).get("/users/me");
    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an unverified email, whatever the provider says", async () => {
    claims.emailVerified = false;
    const res = await request(app).get("/users/me");
    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });
});
