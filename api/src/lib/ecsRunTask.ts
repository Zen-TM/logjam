import { RunTaskCommand } from "@aws-sdk/client-ecs";
import { ecs } from "../services/awsClients";
import { getEnv } from "./env";

// Single Fargate launch helper. Both the topo-job and topo-export
// routes launch workers this way, sharing the placement-failure check below
// so placement failure cannot strand rows in `queued`.

export interface LaunchFargateTaskOptions {
  taskDefinition: string;
  containerName: string;
  environment: { name: string; value: string }[];
  /**
   * Task-level memory in MiB, overriding the task definition's. Fargate takes
   * only its valid sizes for the task's vCPU (8 vCPU: 16 to 60 GiB in 4 GiB
   * steps). Omitted, the task runs at the definition's size.
   */
  memoryMiB?: number;
}

/**
 * Launch a one-off Fargate task and return its task ARN.
 *
 * RunTask returns HTTP 200 with a populated `failures[]` (and no `tasks`)
 * when the task cannot be placed — capacity, ENI, subnet or image-pull
 * issues — without throwing. A bare try/catch would miss this and strand the
 * job row in its pre-launch status forever, so placement failure throws here.
 */
export async function launchFargateTask(
  options: LaunchFargateTaskOptions,
): Promise<string> {
  const env = getEnv();
  const result = await ecs.send(
    new RunTaskCommand({
      cluster: env.ECS_CLUSTER,
      taskDefinition: options.taskDefinition,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: env.ECS_SUBNETS_LIST,
          securityGroups: env.ECS_SECURITY_GROUPS_LIST,
          assignPublicIp: "ENABLED",
        },
      },
      overrides: {
        ...(options.memoryMiB !== undefined && {
          memory: String(options.memoryMiB),
        }),
        containerOverrides: [
          {
            name: options.containerName,
            environment: options.environment,
          },
        ],
      },
    }),
  );

  const failures = result.failures ?? [];
  const taskArn = result.tasks?.[0]?.taskArn;
  if (failures.length > 0 || !taskArn) {
    throw new Error(
      `RunTask placement failed: ${
        failures.map((f) => f.reason ?? "unknown").join(", ") ||
        "no task started"
      }`,
    );
  }
  return taskArn;
}
