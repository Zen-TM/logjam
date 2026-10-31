// DELETE /users/me: Logjam's data goes first and stays gone when the identity
// provider fails to delete the sign-in; the failure is logged, not answered.
//
// Mutations that turn it red: call deleteUser before the transaction, drop the
// try/catch around it (500 instead of 204), or drop the identity_delete_failed
// warning.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const order = vi.hoisted(() => [] as string[]);
const deleteUser = vi.hoisted(() => vi.fn());
const warn = vi.hoisted(() => vi.fn());

vi.mock("../lib/env", () => ({ getEnv: () => process.env }));
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { sub: "sub-1", email: "a@example.com", username: "a" };
    next();
  },
}));
vi.mock("../middleware/rateLimit", () => ({
  userPatchLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../lib/resolveUser", () => ({
  resolveUser: async () => ({ id: "user-1" }),
}));
vi.mock("../lib/identityProvider", () => ({
  identityProvider: () => ({ deleteUser }),
}));
vi.mock("../lib/s3Cleanup", () => ({
  deleteS3Keys: async () => {},
  deleteS3Prefix: async () => {},
}));
vi.mock("../lib/topoUpload", () => ({ deleteTopoJobObjects: async () => {} }));
vi.mock("../lib/logger", async (orig) => ({
  ...(await orig<typeof import("../lib/logger")>()),
  logger: { warn, info: vi.fn(), error: vi.fn() },
}));
// Every delegate method answers an empty list; the transaction is the marker.
vi.mock("../services/prisma", () => {
  const model = new Proxy({}, { get: () => async () => [] });
  return {
    default: new Proxy(
      {
        $transaction: async () => {
          order.push("data deleted");
        },
      },
      { get: (t, k) => (k in t ? t[k as keyof typeof t] : model) },
    ),
  };
});

import { errorHandler } from "../middleware/errorHandler";
import usersRouter from "./users";

const app = express();
app.use("/users", usersRouter);
app.use(errorHandler);

beforeEach(() => {
  order.length = 0;
  deleteUser.mockReset().mockImplementation(async () => {
    order.push("identity deleted");
  });
  warn.mockReset();
});

describe("DELETE /users/me", () => {
  it("deletes Logjam's data, then the identity", async () => {
    const res = await request(app).delete("/users/me");
    expect(res.status).toBe(204);
    expect(order).toEqual(["data deleted", "identity deleted"]);
    expect(deleteUser).toHaveBeenCalledWith("sub-1");
  });

  it("still answers 204, with the data gone, when the adapter throws", async () => {
    deleteUser.mockRejectedValue(new Error("AccessDenied for sub-1"));
    const res = await request(app).delete("/users/me");
    expect(res.status).toBe(204);
    expect(order).toEqual(["data deleted"]);
    expect(warn).toHaveBeenCalledWith(
      { err: expect.objectContaining({ name: "Error" }) },
      "identity_delete_failed",
    );
  });
});
