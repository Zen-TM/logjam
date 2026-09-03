import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    topoJob: { count: vi.fn() },
    topoExportJob: { count: vi.fn() },
    geoPdfJob: { count: vi.fn() },
  },
}));

// vi.hoisted: the mock factory is hoisted above the const declarations, so a
// plain `const getEnvMock = vi.fn()` is still in its temporal dead zone when
// the factory runs. The default value also has to be usable immediately —
// lib/logger.ts calls getEnv() at module scope, transitively via AppError.
const { getEnvMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(() => ({
    MAX_CONCURRENT_WORKER_VCPUS: 24,
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
  })),
}));
vi.mock("./env", () => ({ getEnv: getEnvMock }));

import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getInFlightVcpus, assertGlobalCapacity } from "./fargateCapacity";

const counts = prisma as unknown as {
  topoJob: { count: Mock };
  topoExportJob: { count: Mock };
  geoPdfJob: { count: Mock };
};

function inFlight(topo: number, topoExport: number, geoPdf: number) {
  counts.topoJob.count.mockResolvedValue(topo);
  counts.topoExportJob.count.mockResolvedValue(topoExport);
  counts.geoPdfJob.count.mockResolvedValue(geoPdf);
}

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({
    MAX_CONCURRENT_WORKER_VCPUS: 24,
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
  });
});

describe("getInFlightVcpus", () => {
  it("weights each worker by its task definition size", async () => {
    // 1 topo (8) + 2 exports (4 each) + 3 GeoPDFs (1 each) = 19.
    inFlight(1, 2, 3);
    expect(await getInFlightVcpus()).toBe(19);
  });

  it("is zero when nothing is running", async () => {
    inFlight(0, 0, 0);
    expect(await getInFlightVcpus()).toBe(0);
  });

  it("counts only in-flight statuses", async () => {
    inFlight(0, 0, 0);
    await getInFlightVcpus();
    expect(counts.topoJob.count).toHaveBeenCalledWith({
      where: { status: { in: ["pending", "processing"] } },
    });
    expect(counts.topoExportJob.count).toHaveBeenCalledWith({
      where: { status: { in: ["queued", "running"] } },
    });
  });
});

describe("assertGlobalCapacity", () => {
  it("admits a launch that fits under the ceiling", async () => {
    inFlight(2, 0, 0); // 16 in flight, +8 = 24, exactly at the ceiling.
    await expect(assertGlobalCapacity("topo")).resolves.toBeUndefined();
  });

  it("refuses a launch that would cross the ceiling", async () => {
    inFlight(2, 0, 1); // 17 in flight, +8 = 25 > 24.
    await expect(assertGlobalCapacity("topo")).rejects.toThrow(AppError);
  });

  it("refuses with 429 and a retryable message, not a 5xx", async () => {
    // Clients already treat 429 as "retryable, show the message"; a capacity
    // refusal must not look like a crash.
    inFlight(3, 0, 0);
    try {
      await assertGlobalCapacity("topo");
      expect.unreachable("should have thrown");
    } catch (err) {
      const appError = err as AppError;
      expect(appError.statusCode).toBe(429);
      expect(appError.message).toMatch(/capacity/i);
    }
  });

  it("still admits a small worker when a large one would not fit", async () => {
    // The reason the ceiling is measured in vCPUs: at 20 in flight there is
    // room for a GeoPDF but not a topo job.
    inFlight(2, 1, 0); // 20
    await expect(assertGlobalCapacity("geoPdf")).resolves.toBeUndefined();
    await expect(assertGlobalCapacity("topo")).rejects.toThrow(AppError);
  });

  it("is disabled at 0 and does not even query", async () => {
    getEnvMock.mockReturnValue({
      MAX_CONCURRENT_WORKER_VCPUS: 0,
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    });
    await expect(assertGlobalCapacity("topo")).resolves.toBeUndefined();
    expect(counts.topoJob.count).not.toHaveBeenCalled();
  });
});
