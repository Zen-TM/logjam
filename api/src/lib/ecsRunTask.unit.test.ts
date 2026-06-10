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
    await expect(launchFargateTask(options)).rejects.toThrow(
      /no task started/,
    );
  });

  it("throws when tasks is undefined", async () => {
    send.mockResolvedValue({});
    await expect(launchFargateTask(options)).rejects.toThrow(
      /RunTask placement failed/,
    );
  });
});
