import { describe, it, expect, vi } from "vitest";

const count = vi.hoisted(() => vi.fn());
vi.mock("../services/prisma", () => ({
  default: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: vi.fn(),
        topoExportJob: { count, create: vi.fn() },
      }),
  },
}));
vi.mock("./runtimeEstimates", () => ({ estimateExportSeconds: async () => 1 }));
vi.mock("./computeCredits", () => ({ assertHasCredits: async () => {} }));
vi.mock("./fargateCapacity", () => ({ assertGlobalCapacity: async () => {} }));
vi.mock("./ecsRunTask", () => ({ launchFargateTask: vi.fn() }));

import {
  createAndLaunchTopoExport,
  MAX_LIVE_PER_USER,
  MAX_QUEUED_PER_USER,
} from "./topoExportLauncher";

const input = {
  userId: "u1",
  sourceJobIds: [],
  layers: ["contours"],
  format: "gpkg" as const,
  bundling: "composite" as const,
  vectorStyleSnapshot: {},
  sourceTileCount: null,
  monthlyComputeCredits: 100,
};

// Exports are not charged to storage, so this cap is what bounds the files one
// user holds. Mutation: drop the live-count check and the 20th export queues.
describe("createAndLaunchTopoExport caps", () => {
  it("refuses an export past the live cap, counting no failed ones", async () => {
    count
      .mockReset()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(MAX_LIVE_PER_USER);
    await expect(createAndLaunchTopoExport(input)).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(count.mock.calls[1][0].where.status).toEqual({ not: "failed" });
  });

  it("still refuses past the in-flight cap first", async () => {
    count.mockReset().mockResolvedValueOnce(MAX_QUEUED_PER_USER);
    await expect(createAndLaunchTopoExport(input)).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(count).toHaveBeenCalledTimes(1);
  });
});
