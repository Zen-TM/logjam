// The pure decisions of Plans' forms, out of the components so a test can
// hold them (frontend/DESIGN.md §4): an edit sends only what changed, each as
// the value last seen and the new one (design §4, shared/DESIGN.md §10).
import type {
  TripPlanCreate,
  TripPlanPatch,
  TripPlanSectionPatch,
} from "@logjam/shared";

export type PlanValues = Required<TripPlanCreate>;
export type SectionValues = { title: string; body: string };

/** Only the fields that changed, each as a compare-and-set pair. */
export function planPatch(was: PlanValues, now: PlanValues): TripPlanPatch {
  const patch: TripPlanPatch = {};
  if (now.name !== was.name) patch.name = { from: was.name, to: now.name };
  if (now.startDate !== was.startDate || now.endDate !== was.endDate)
    patch.dates = {
      from: { startDate: was.startDate, endDate: was.endDate },
      to: { startDate: now.startDate, endDate: now.endDate },
    };
  if (now.tripTypes.join("\n") !== was.tripTypes.join("\n"))
    patch.tripTypes = { from: was.tripTypes, to: now.tripTypes };
  return patch;
}

/** Only what changed, against what the form last saw of the plan. */
export function sectionPatch(
  seen: SectionValues,
  now: SectionValues,
): TripPlanSectionPatch {
  const patch: TripPlanSectionPatch = {};
  if (now.title !== seen.title)
    patch.title = { from: seen.title, to: now.title };
  if (now.body !== seen.body) patch.body = { from: seen.body, to: now.body };
  return patch;
}
