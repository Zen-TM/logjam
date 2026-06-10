import { RunTaskCommand } from "@aws-sdk/client-ecs";
import { ecs } from "../services/awsClients";
import { getEnv } from "./env";

// Single Fargate launch helper (Design L3). Both the topo-job and topo-export
// routes launch workers this way; the placement-failure check below existed
// only on the topo-job path before, which is how the export pipeline ended up
// stranding rows in `queued` on placement failure (ARCH-002).

export interface LaunchFargateTaskOptions {
  taskDefinition: string;
  containerName: string;
  environment: { name: string; value: string }[];
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
        failures.map((f) => f.reason ?? "unknown").join(", ") || "no task started"
      }`,
    );
  }
  return taskArn;
}
