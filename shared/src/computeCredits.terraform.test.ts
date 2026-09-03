/**
 * WORKER_SPECS vs the Terraform task definitions — the second half of a
 * hand-kept parallel list.
 *
 * Repo convention (CLAUDE.md): "Two lists that must agree = one declaration
 * plus a test." The billing model here is only correct while its vCPU numbers
 * match what Fargate is actually asked to provision. Resizing a worker in
 * ecs.tf without touching WORKER_SPECS would silently mis-bill every user —
 * under-charging (the cap stops working) or over-charging (legitimate work is
 * refused) — with nothing failing anywhere to say so.
 *
 * This parses the real Terraform rather than a copy of it, so the test cannot
 * pass against a stale duplicate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WORKER_SPECS, type WorkerKind } from "./computeCredits.js";

const here = dirname(fileURLToPath(import.meta.url));
const ECS_TF = resolve(here, "../../infra/terraform/envs/prod/ecs.tf");

/** Terraform's `cpu` is in CPU units; 1024 units = 1 vCPU. */
const CPU_UNITS_PER_VCPU = 1024;
const MIB_PER_GIB = 1024;

const FAMILY_TO_KIND: Record<string, WorkerKind> = {
  "logjam-topo-worker": "topo",
  "logjam-topo-export-worker": "topoExport",
  "logjam-geo-pdf-worker": "geoPdf",
};

type ParsedTaskDef = { family: string; cpu: number; memory: number };

/**
 * Pull (family, cpu, memory) out of every aws_ecs_task_definition block.
 *
 * Deliberately dumb string handling rather than a real HCL parser: the blocks
 * are flat top-level resources with quoted scalar attributes, and adding an HCL
 * dependency to `shared` to read three numbers would cost more than it saves.
 */
function parseTaskDefinitions(hcl: string): ParsedTaskDef[] {
  const blocks = hcl.split(/resource\s+"aws_ecs_task_definition"/).slice(1);
  const parsed: ParsedTaskDef[] = [];
  for (const block of blocks) {
    const family = /\bfamily\s*=\s*"([^"]+)"/.exec(block)?.[1];
    const cpu = /\bcpu\s*=\s*"(\d+)"/.exec(block)?.[1];
    const memory = /\bmemory\s*=\s*"(\d+)"/.exec(block)?.[1];
    if (family && cpu && memory) {
      parsed.push({ family, cpu: Number(cpu), memory: Number(memory) });
    }
  }
  return parsed;
}

describe("WORKER_SPECS matches infra/terraform/envs/prod/ecs.tf", () => {
  const taskDefs = parseTaskDefinitions(readFileSync(ECS_TF, "utf8"));

  it("finds the worker task definitions (guards the parser itself)", () => {
    // If the regexes ever stop matching, every per-worker assertion below would
    // vacuously pass. Assert the parse worked before trusting it.
    const families = taskDefs.map((t) => t.family);
    for (const family of Object.keys(FAMILY_TO_KIND)) {
      expect(families).toContain(family);
    }
  });

  for (const [family, kind] of Object.entries(FAMILY_TO_KIND)) {
    it(`${family} → WORKER_SPECS.${kind}`, () => {
      const taskDef = taskDefs.find((t) => t.family === family);
      expect(taskDef, `no task definition with family ${family}`).toBeDefined();
      expect(taskDef!.cpu / CPU_UNITS_PER_VCPU).toBe(WORKER_SPECS[kind].vcpus);
      expect(taskDef!.memory / MIB_PER_GIB).toBe(WORKER_SPECS[kind].memoryGiB);
    });
  }

  it("covers every worker kind — a new worker must join the cost model", () => {
    expect(Object.values(FAMILY_TO_KIND).sort()).toEqual(
      Object.keys(WORKER_SPECS).sort(),
    );
  });
});
