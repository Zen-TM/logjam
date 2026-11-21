// What the one "Add a place or way" button and its sheet draw on Logjam GPS:
// `planItemAddMenu`'s declaration for this role, with where its rule goes.
import {
  planItemAddMenu,
  type IconIdea,
  type PlanItemAddVerbId,
  type PlanVerb,
  type TripPlanRole,
} from "@logjam/shared";

export type PlanAddMenuView = {
  label: string;
  icon: IconIdea;
  rows: { verb: PlanVerb<PlanItemAddVerbId>; ruled: boolean }[];
};

/** Null when the role has no add (an archived plan). */
export function planAddMenuView(
  role: TripPlanRole,
  archived: boolean,
): PlanAddMenuView | null {
  const menu = planItemAddMenu("gps", role, archived);
  if (!menu) return null;
  return {
    label: menu.label,
    icon: menu.icon,
    // A rule above the first separated verb, as Logjam Web's menu draws it.
    rows: menu.verbs.map((verb, at, all) => ({
      verb,
      ruled: verb.separated && at > 0 && !all[at - 1].separated,
    })),
  };
}
