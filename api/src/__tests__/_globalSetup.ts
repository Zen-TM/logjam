// Checks the database is the seed, then hands it over as the baseline; _cleanup.ts sweeps back to it.
import type { TestProject } from "vitest/node";
import prisma from "../services/prisma";
import {
  describeSeedMismatch,
  loadSeedSnapshot,
  takeSnapshot,
  type Snapshot,
} from "./_seedBaseline";

declare module "vitest" {
  export interface ProvidedContext {
    seedBaseline: Snapshot;
  }
}

export default async function setup(project: TestProject) {
  // The baseline is the seed, not whatever the database holds now: rows left
  // by an earlier killed run must fail here, not become "seed" (#278).
  const seed = await loadSeedSnapshot();
  const problem = describeSeedMismatch(seed, await takeSnapshot());
  if (problem) throw new Error(problem);
  project.provide("seedBaseline", seed!);
  return () => prisma.$disconnect();
}
