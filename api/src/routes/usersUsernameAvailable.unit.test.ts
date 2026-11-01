// GET /users/username-available: the one user-data answer given before sign-in
// (api/AGENTS.md), so it stays a yes or no and stays behind its own limiter.
//
// Mutations that turn it red: return the row or anything else from it; drop the
// usernameSchema check, so any string reaches the query; or remove
// usernameCheckLimiter from the route (rateLimit.unit.test.ts counts it).
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.hoisted(() => vi.fn());

vi.mock("../lib/env", () => ({ getEnv: () => process.env }));
vi.mock("../services/prisma", () => ({ default: { $queryRaw: queryRaw } }));

import { errorHandler } from "../middleware/errorHandler";
import usersRouter from "./users";

const app = express();
app.use("/users", usersRouter);
app.use(errorHandler);

const ask = (username: string) =>
  request(app).get("/users/username-available").query({ username });

beforeEach(() => queryRaw.mockReset().mockResolvedValue([]));

describe("GET /users/username-available", () => {
  it("answers with no token, and says a free name is free", async () => {
    const res = await ask("canyoneer");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });
  });

  it("says only no for a taken name", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await ask("canyoneer");
    expect(res.body).toEqual({ available: false });
  });

  it("refuses what could never be a username, without asking the database", async () => {
    const res = await ask("not a name!");
    expect(res.status).toBe(400);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
