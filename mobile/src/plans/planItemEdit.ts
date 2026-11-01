// An item's edit form: a place's name and notes, a way's or a file's name.
// Position, attributes and geometry are edited where the thing was made.
// Logjam Web's twin is frontend/src/components/plans/plansModel.ts
// (`itemWords`, `itemPatch`).
import type {
  TripPlanFilePatch,
  TripPlanItem,
  TripPlanPlacePatch,
  TripPlanRoutePatch,
} from "@logjam/shared";

export type ItemWords = { name: string; notes: string };

export function itemWords(item: TripPlanItem): ItemWords {
  switch (item.kind) {
    case "place":
      return { name: item.name, notes: item.notes ?? "" };
    case "route":
      return { name: item.name, notes: "" };
    case "media":
      return { name: item.item.displayName ?? "", notes: "" };
  }
}

/** The compare-and-set body, or null when nothing changed. Each `from` is
 *  the stored value, never the form's blanked words: the API compares it
 *  exactly, and a stored "" is not null. */
export function itemPatch(
  seen: TripPlanItem,
  now: ItemWords,
): TripPlanPlacePatch | TripPlanRoutePatch | TripPlanFilePatch | null {
  const was = itemWords(seen);
  const name = now.name.trim();
  if (seen.kind === "media")
    return name === was.name
      ? null
      : {
          displayName: {
            from: seen.item.displayName ?? null,
            to: name || null,
          },
        };
  const patch: TripPlanPlacePatch = {};
  if (name !== was.name) patch.name = { from: seen.name, to: name };
  if (seen.kind === "place" && now.notes !== was.notes)
    patch.notes = { from: seen.notes, to: now.notes.trim() || null };
  return Object.keys(patch).length > 0 ? patch : null;
}
