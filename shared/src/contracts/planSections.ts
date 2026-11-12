// A plan's write-up sections, the rules both clients' section ⋯ and form
// run: which verbs a section's position allows, the order a move sends, and
// the live limit line under its body.
import type { ContractPlatform } from "./types.js";
import {
  planVerbsFor,
  PLAN_SECTION_VERBS,
  type PlanSectionVerbId,
  type PlanVerb,
} from "./planVerbs.js";
import type { TripPlanRole } from "../tripPlans.js";

/** A section's ⋯: no Move up for the first, no Move down for the last. */
export function planSectionVerbs(
  platform: ContractPlatform,
  role: TripPlanRole,
  state: { archived: boolean; index: number; count: number },
): PlanVerb<PlanSectionVerbId>[] {
  return planVerbsFor(PLAN_SECTION_VERBS, platform, role, state).filter(
    (verb) =>
      !(verb.id === "moveUp" && state.index === 0) &&
      !(verb.id === "moveDown" && state.index === state.count - 1),
  );
}

/** The ids in their new order after a move, or null past either end. */
export function planSectionsMoved(
  ids: readonly string[],
  index: number,
  by: -1 | 1,
): string[] | null {
  const to = index + by;
  if (index < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** A limit shows live near it (shared/DESIGN.md §11): "18200 of 20000
 *  characters" past 90 %, nothing before. */
export function limitHint(length: number, max: number): string | undefined {
  return length > max * 0.9 ? `${length} of ${max} characters` : undefined;
}
