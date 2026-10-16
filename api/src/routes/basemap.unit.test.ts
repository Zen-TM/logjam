import { PassThrough } from "node:stream";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/errorHandler";

const source = vi.hoisted(() => ({ current: null as null | (() => unknown) }));

vi.mock("fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs")>()),
  createReadStream: () => source.current!(),
}));
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { sub: "sub" };
    next();
  },
}));
vi.mock("../lib/resolveUser", () => ({
  resolveUser: async () => ({ id: "user" }),
}));
vi.mock("../lib/regionClip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/regionClip")>()),
  createClipTokenStore: () => ({
    issue: () => ({ token: "t", expiresAt: 0 }),
    take: () => ({ path: "/nonexistent/clip", sizeBytes: 10 }),
    sweepExpired: () => [],
  }),
}));

const { default: basemapRouter } = await import("./basemap");

const app = express();
app.use("/basemap", basemapRouter);
app.use(errorHandler);

// A clip that dies mid-stream must not end as a download that looks complete.
// Mutation: answer `res.status(500).end()` (or end the response) in the
// headers-sent branch of the stream's error handler in routes/basemap.ts; or
// drop the `removeHeader` calls in the other branch.
describe("GET /basemap/region-clip/:token when the file stream fails", () => {
  it("destroys the response once the download has started", async () => {
    source.current = () => {
      const stream = new PassThrough();
      stream.write("x");
      setTimeout(() => stream.destroy(new Error("disk")), 20);
      return stream;
    };
    await expect(request(app).get("/basemap/region-clip/t")).rejects.toThrow();
  });

  it("answers 503 with the user sentence when it fails before any byte", async () => {
    source.current = () => {
      const stream = new PassThrough();
      setImmediate(() => stream.destroy(new Error("disk")));
      return stream;
    };
    const res = await request(app).get("/basemap/region-clip/t");
    expect(res.status).toBe(503);
    expect(res.headers["content-type"]).toMatch(/json/); // not the clip's octet-stream
    expect(res.body.error).toBe("That download failed. Start it again.");
  });
});
