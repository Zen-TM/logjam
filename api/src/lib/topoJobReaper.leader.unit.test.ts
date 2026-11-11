import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Guard that every sweep tick goes through the sweep leader. Mutation that
// turns it red: setInterval(runOnce, ...) in startTopoJobReaper, bypassing
// `leader.runIfLeader`.

const { runIfLeader, stop } = vi.hoisted(() => ({
  runIfLeader: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("./sweepLeader", () => ({
  createSweepLeader: () => ({ runIfLeader, stop }),
}));
vi.mock("../services/prisma", () => ({
  default: { topoJob: { findMany: vi.fn().mockResolvedValue([]) } },
}));
vi.mock("../services/awsClients", () => ({
  ecs: { send: vi.fn() },
  s3: { send: vi.fn() },
}));
vi.mock("../services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("../services/push", () => ({ sendPushToUser: vi.fn() }));

import prisma from "../services/prisma";
import { startTopoJobReaper } from "./topoJobReaper";

const findMany = prisma.topoJob.findMany as unknown as ReturnType<typeof vi.fn>;

describe("startTopoJobReaper and the sweep leader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    findMany.mockClear();
    runIfLeader.mockReset();
    runIfLeader.mockResolvedValue(false);
    stop.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("sweeps only when the leader runs the tick", async () => {
    runIfLeader.mockResolvedValue(false);
    const stopReaper = startTopoJobReaper();
    await vi.advanceTimersByTimeAsync(310_000);
    expect(runIfLeader).toHaveBeenCalledTimes(2); // boot tick and one interval
    expect(findMany).not.toHaveBeenCalled();

    runIfLeader.mockImplementation(async (tick: () => void) => {
      tick();
      return true;
    });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(findMany).toHaveBeenCalled();
    stopReaper();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("creates no leader and no timer at interval 0", async () => {
    vi.resetModules();
    vi.stubEnv("TOPO_REAPER_INTERVAL_MS", "0");
    const { startTopoJobReaper: start } = await import("./topoJobReaper");
    start()();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(runIfLeader).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
});
