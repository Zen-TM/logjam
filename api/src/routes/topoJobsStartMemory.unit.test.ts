import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/env", () => ({
  getEnv: () => ({
    ...process.env,
    S3_BUCKET_TOPO: "bucket",
    ECS_TOPO_TASK_DEF: "logjam-topo-worker",
    ECS_SUBNETS_LIST: ["subnet-1"],
  }),
}));
vi.mock("../lib/resolveUser", () => ({
  resolveUser: async () => ({ id: "user-1" }),
}));
vi.mock("../lib/shareAccess", async (original) => ({
  ...(await original<typeof import("../lib/shareAccess")>()),
  getJobRole: async () => "owner",
}));
const findJob = vi.hoisted(() => vi.fn());
vi.mock("../services/prisma", () => ({
  default: {
    topoJob: {
      findUnique: findJob,
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
    },
    $transaction: async (run: (tx: unknown) => unknown) =>
      run({
        $executeRaw: async () => 0,
        topoJob: { updateMany: async () => ({ count: 1 }) },
      }),
  },
}));
vi.mock("../services/awsClients", () => ({
  s3: {
    send: async (cmd: { constructor: { name: string } }) =>
      cmd.constructor.name === "HeadObjectCommand"
        ? { ContentLength: 1024 }
        : { Body: { transformToByteArray: async () => new Uint8Array(22) } },
  },
  ecs: { send: vi.fn() },
}));
const launch = vi.hoisted(() => vi.fn());
vi.mock("../lib/ecsRunTask", () => ({ launchFargateTask: launch }));
vi.mock("../lib/computeCredits", () => ({ assertHasCredits: async () => {} }));
vi.mock("../lib/storageQuota", () => ({
  assertHasStorageQuota: async () => {},
}));
vi.mock("../lib/fargateCapacity", () => ({
  assertGlobalCapacity: async () => {},
}));
vi.mock("../lib/runtimeEstimates", () => ({
  estimateTopoSeconds: async () => 60,
}));
const zip = vi.hoisted(() => ({ lazCount: 0 }));
vi.mock("@logjam/shared", async (original) => ({
  ...(await original<typeof import("@logjam/shared")>()),
  readZipEntries: async () => [],
  classifyElvisEntries: () => ({
    uncompressedBytes: 1,
    tileCount: zip.lazCount,
    lazCount: zip.lazCount,
  }),
}));

import { errorHandler } from "../middleware/errorHandler";
import topoJobsRouter from "./topoJobs";

const app = express();
app.use(express.json());
app.use("/topo-jobs", topoJobsRouter);
app.use(errorHandler);

const TICKED = { vegetation: { enabled: true } };

beforeEach(() => {
  process.env.AUTH_MODE = "fake";
  launch.mockReset().mockResolvedValue("arn:task");
});

/** Start a job of `lazCount` point clouds whose settings are `layerOptions`
 *  and return what the launch was given. */
async function started(lazCount: number, layerOptions: unknown) {
  zip.lazCount = lazCount;
  findJob.mockResolvedValue({
    id: "job-1",
    userId: "user-1",
    status: "uploading",
    s3InputKey: "k",
    layerOptions,
  });
  const res = await request(app).post("/topo-jobs/job-1/start");
  expect(res.status).toBe(200);
  return launch.mock.calls[0]![0];
}

describe("POST /topo-jobs/:id/start sizes the task", () => {
  // Mutation: drop `memoryMiB` from the launch, and a large ticked area runs in
  // 16 GiB and is left without its vegetation layer when 32 would have fitted.
  it("asks for a larger task for a ticked job of many point clouds", async () => {
    expect((await started(100, TICKED)).memoryMiB).toBe(32768);
  });

  // Mutation: size an unticked job too, and it pays for memory it never uses.
  it("launches an unticked job, and a small ticked one, as the definition says", async () => {
    expect((await started(100, {})).memoryMiB).toBeUndefined();
    launch.mockClear();
    expect((await started(3, TICKED)).memoryMiB).toBeUndefined();
  });

  // Mutation: drop `lazCount > 0` from `sharpenMark` and size from
  // `(lazCount || 100)` tiles, and a ZIP with no point clouds gets a larger task.
  it("launches a ZIP with no point clouds as the definition says", async () => {
    expect((await started(0, TICKED)).memoryMiB).toBeUndefined();
  });
});
