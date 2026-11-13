import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/awsClients", () => ({
  ecs: { send: vi.fn() },
}));

import { ecs } from "../services/awsClients";
import { launchFargateTask } from "./ecsRunTask";

const send = (ecs as unknown as { send: Mock }).send;

const options = {
  taskDefinition: "logjam-topo-worker",
  containerName: "topo-worker",
  environment: [{ name: "JOB_ID", value: "job-1" }],
};

beforeEach(() => send.mockReset());

describe("launchFargateTask", () => {
  it("returns the task ARN on a successful placement", async () => {
    send.mockResolvedValue({
      tasks: [{ taskArn: "arn:aws:ecs:ap-southeast-2:1:task/abc" }],
      failures: [],
    });
    await expect(launchFargateTask(options)).resolves.toBe(
      "arn:aws:ecs:ap-southeast-2:1:task/abc",
    );
  });

  // Mutation: drop the override (a ticked job's bigger task is never asked
  // for), or send it when none was asked (every job launches at a made-up size).
  it("overrides the task's memory only when asked", async () => {
    send.mockResolvedValue({ tasks: [{ taskArn: "arn" }], failures: [] });
    await launchFargateTask({ ...options, memoryMiB: 32768 });
    expect(send.mock.calls[0]![0].input.overrides.memory).toBe("32768");
    await launchFargateTask(options);
    expect(send.mock.calls[1]![0].input.overrides).not.toHaveProperty("memory");
  });

  it("throws with the failure reason when RunTask reports failures[]", async () => {
    send.mockResolvedValue({
      tasks: [],
      failures: [{ reason: "RESOURCE:MEMORY" }],
    });
    await expect(launchFargateTask(options)).rejects.toThrow(
      /RunTask placement failed: RESOURCE:MEMORY/,
    );
  });

  it("throws when RunTask returns no tasks and no failures", async () => {
    send.mockResolvedValue({ tasks: [], failures: [] });
    await expect(launchFargateTask(options)).rejects.toThrow(/no task started/);
  });

  it("throws when tasks is undefined", async () => {
    send.mockResolvedValue({});
    await expect(launchFargateTask(options)).rejects.toThrow(
      /RunTask placement failed/,
    );
  });
});
