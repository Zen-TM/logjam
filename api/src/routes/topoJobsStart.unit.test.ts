import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/env", () => ({ getEnv: () => process.env }));
vi.mock("../lib/resolveUser", () => ({
  resolveUser: async () => ({ id: "user-1" }),
}));
vi.mock("../lib/shareAccess", async (original) => ({
  ...(await original<typeof import("../lib/shareAccess")>()),
  getJobRole: async () => "owner",
}));
const findJob = vi.hoisted(() => vi.fn());
vi.mock("../services/prisma", () => ({
  default: { topoJob: { findUnique: findJob } },
}));
const s3Send = vi.hoisted(() => vi.fn());
vi.mock("../services/awsClients", () => ({
  s3: { send: s3Send },
  ecs: { send: vi.fn() },
}));
// The central directory is declared by the ZIP itself, so the test names the
// total it declares rather than building a ZIP of that size.
const declared = vi.hoisted(() => ({ uncompressedBytes: 0 }));
vi.mock("@logjam/shared", async (original) => ({
  ...(await original<typeof import("@logjam/shared")>()),
  parseZipCentralDirectory: () => [],
  classifyElvisEntries: () => ({
    uncompressedBytes: declared.uncompressedBytes,
    tileCount: 1,
    lazCount: 1,
  }),
}));

import {
  MAX_INPUT_ZIP_COMPRESSED_BYTES,
  MAX_INPUT_ZIP_UNCOMPRESSED_BYTES,
} from "../lib/topoUpload";
import { errorHandler } from "../middleware/errorHandler";
import topoJobsRouter from "./topoJobs";

const app = express();
app.use(express.json());
app.use("/topo-jobs", topoJobsRouter);
app.use(errorHandler);

const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;
beforeEach(() => {
  process.env.AUTH_MODE = "fake";
  findJob.mockResolvedValue({
    id: "job-1",
    userId: "user-1",
    status: "uploading",
    s3InputKey: "k",
  });
});
afterEach(() => {
  process.env.AUTH_MODE = ORIGINAL_AUTH_MODE;
  findJob.mockReset();
  s3Send.mockReset();
});

/** S3 answers the size check (HeadObject), then the central directory's tail. */
function uploaded(objectSize: number) {
  s3Send.mockImplementation(async (cmd: { constructor: { name: string } }) =>
    cmd.constructor.name === "HeadObjectCommand"
      ? { ContentLength: objectSize }
      : { Body: { transformToByteArray: async () => new Uint8Array(22) } },
  );
}

describe("POST /topo-jobs/:id/start refuses a ZIP over the caps", () => {
  // Mutation that turns it red: drop the compressed check in the route, or
  // change its `>` to `>=` (the second case).
  it("refuses an object larger than the compressed cap", async () => {
    uploaded(MAX_INPUT_ZIP_COMPRESSED_BYTES + 1);
    const res = await request(app).post("/topo-jobs/job-1/start");
    expect(res.status).toBe(413);
    expect(res.body.error).toBe(
      "That ZIP is larger than Logjam can take. Choose a smaller area.",
    );
  });

  it("does not refuse one of exactly the compressed cap on size", async () => {
    uploaded(MAX_INPUT_ZIP_COMPRESSED_BYTES);
    declared.uncompressedBytes = MAX_INPUT_ZIP_UNCOMPRESSED_BYTES + 1;
    const res = await request(app).post("/topo-jobs/job-1/start");
    expect(res.body.error).toMatch(/holds more data/);
  });

  // Mutation that turns it red: drop the uncompressed check in the route.
  it("refuses a central directory declaring more than the uncompressed cap", async () => {
    uploaded(1024);
    declared.uncompressedBytes = MAX_INPUT_ZIP_UNCOMPRESSED_BYTES + 1;
    const res = await request(app).post("/topo-jobs/job-1/start");
    expect(res.status).toBe(413);
    expect(res.body.error).toBe(
      "That ZIP holds more data than Logjam can process. Choose a smaller area.",
    );
  });
});
