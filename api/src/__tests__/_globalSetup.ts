// Takes the seeded baseline once per run; _cleanup.ts sweeps back to it.
import type { TestProject } from "vitest/node";
import prisma from "../services/prisma";
import { takeSnapshot, type Snapshot } from "./_seedBaseline";

declare module "vitest" {
  export interface ProvidedContext {
    seedBaseline: Snapshot;
  }
}

export default async function setup(project: TestProject) {
  project.provide("seedBaseline", await takeSnapshot());
  return () => prisma.$disconnect();
}
