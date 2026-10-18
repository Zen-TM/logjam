import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { indexPlaceRegistry } from "@logjam/shared";

vi.mock("../services/prisma", () => ({ default: {} }));
// The search answers from the shared fixture, so a request the limiter lets
// through is a 200.
vi.mock("../services/placeRegistry", () => ({
  placeIndex: () => ({
    index: indexPlaceRegistry(
      JSON.parse(
        readFileSync(
          join(
            __dirname,
            "../../../shared/src/__fixtures__/place-registry.json",
          ),
          "utf8",
        ),
      ),
    ),
    version: "fixture",
  }),
}));

import type { AuthenticatedRequest } from "./auth";
import {
  bulkImportLimiter,
  bulkImportLimitMax,
  globalLimitMax,
  PLACE_SEARCHES_PER_MINUTE,
  REGION_CLIPS_PER_HOUR,
  regionClipLimiter,
  userPatchLimitMax,
} from "./rateLimit";
import placesBulk from "../routes/placesBulk";
import tripLogsBulk from "../routes/tripLogsBulk";
import placeSearch from "../routes/placeSearch";

// The override exists so CI's integration run (one shared per-IP bucket, ~250
// tests) isn't throttled. The property that matters is that it is inert in
// production — same fail-closed shape as the AUTH_MODE=fake guard.
describe("globalLimitMax", () => {
  it("defaults to 300 with no override", () => {
    expect(globalLimitMax({})).toBe(300);
    expect(globalLimitMax({ NODE_ENV: "development" })).toBe(300);
  });

  it("honours RATE_LIMIT_GLOBAL_MAX outside production", () => {
    expect(
      globalLimitMax({
        NODE_ENV: "development",
        RATE_LIMIT_GLOBAL_MAX: "100000",
      }),
    ).toBe(100000);
  });

  it("IGNORES the override in production", () => {
    expect(
      globalLimitMax({
        NODE_ENV: "production",
        RATE_LIMIT_GLOBAL_MAX: "100000",
      }),
    ).toBe(300);
  });

  it("ignores junk / non-positive / non-integer values", () => {
    for (const RATE_LIMIT_GLOBAL_MAX of [
      "",
      "abc",
      "0",
      "-5",
      "1.5",
      "Infinity",
    ]) {
      expect(globalLimitMax({ RATE_LIMIT_GLOBAL_MAX })).toBe(300);
    }
  });
});

describe("userPatchLimitMax", () => {
  it("defaults to 30, takes the CI override, and ignores it in production", () => {
    expect(userPatchLimitMax({})).toBe(30);
    expect(
      userPatchLimitMax({
        NODE_ENV: "development",
        RATE_LIMIT_USER_PATCH_MAX: "100000",
      }),
    ).toBe(100000);
    expect(
      userPatchLimitMax({
        NODE_ENV: "production",
        RATE_LIMIT_USER_PATCH_MAX: "100000",
      }),
    ).toBe(30);
  });
});

describe("bulkImportLimiter", () => {
  it("defaults to 60, takes the CI override, and ignores it in production", () => {
    expect(bulkImportLimitMax({})).toBe(60);
    expect(
      bulkImportLimitMax({
        NODE_ENV: "development",
        RATE_LIMIT_BULK_IMPORT_MAX: "100000",
      }),
    ).toBe(100000);
    expect(
      bulkImportLimitMax({
        NODE_ENV: "production",
        RATE_LIMIT_BULK_IMPORT_MAX: "100000",
      }),
    ).toBe(60);
  });

  // Mutation that turns this red: dropping bulkImportLimiter from either
  // router.post("/") in routes/placesBulk.ts or routes/tripLogsBulk.ts.
  it("is mounted on POST / of both import routes", () => {
    for (const router of [placesBulk, tripLogsBulk]) {
      const layer = (
        router as unknown as {
          stack: {
            route?: {
              path: string;
              methods: { post?: boolean };
              stack: { handle: unknown }[];
            };
          }[];
        }
      ).stack.find((l) => l.route?.path === "/" && l.route.methods.post);
      expect(layer!.route!.stack.map((h) => h.handle)).toContain(
        bulkImportLimiter,
      );
    }
  });
});

// Every signed-in region save in a Logjam GPS build older than the phone-cut
// clips asks for one clip
// (docs/decisions/0036-the-phone-cuts-its-own-offline-clips.md), so the limit
// has to sit above an honest session and still be a limit. Mutation: set REGION_CLIPS_PER_HOUR back to 10 and the
// first test goes red (a user planning a trip is refused at the eleventh
// area); drop `regionClipLimiter` from the route chain here and the second
// goes red.
describe("regionClipLimiter", () => {
  function clipApp() {
    const app = express();
    app.use((req, _res, next) => {
      (req as AuthenticatedRequest).user = {
        sub: String(req.headers["x-test-sub"]),
      } as AuthenticatedRequest["user"];
      next();
    });
    app.post("/clip", regionClipLimiter, (_req, res) => {
      res.sendStatus(200);
    });
    return app;
  }

  it("lets one user save thirty areas in an hour", async () => {
    expect(REGION_CLIPS_PER_HOUR).toBeGreaterThanOrEqual(30);
    const app = clipApp();
    for (let i = 0; i < 30; i++) {
      const res = await request(app).post("/clip").set("x-test-sub", "heavy");
      expect(res.status).toBe(200);
    }
  });

  it("still refuses past the limit, per user", async () => {
    const app = clipApp();
    for (let i = 0; i < REGION_CLIPS_PER_HOUR; i++) {
      await request(app).post("/clip").set("x-test-sub", "greedy");
    }
    const over = await request(app).post("/clip").set("x-test-sub", "greedy");
    expect(over.status).toBe(429);
    const other = await request(app).post("/clip").set("x-test-sub", "other");
    expect(other.status).toBe(200);
  });
});

// Location search as you type, through the real router: requireAuth first, so
// the limiter counts each user apart. Mutation: drop `placeSearchLimiter` from
// the route, or move it before `requireAuth` (one bucket for everyone behind
// an address), and this goes red.
describe("placeSearchLimiter", () => {
  it("lets one user search PLACE_SEARCHES_PER_MINUTE times, then refuses only them", async () => {
    const app = express();
    app.use(express.json());
    app.use("/places/search", placeSearch);
    const search = (sub: string) =>
      request(app)
        .post("/places/search")
        .set("x-fake-sub", sub)
        .send({ q: "katoomba" });

    for (let i = 0; i < PLACE_SEARCHES_PER_MINUTE; i++) {
      expect((await search("fast-typist")).status).toBe(200);
    }
    expect((await search("fast-typist")).status).toBe(429);
    expect((await search("someone-else")).status).toBe(200);
  });
});
