import { plural, t } from "@logjam/shared";
import type { UndoImportResult } from "../../placeUtils";

/** "2 places and 1 trip", "3 trips", or null when both counts are zero. */
const nouns = (places: number | undefined, trips: number | undefined) => {
  const p = places ? plural(places, "# place", "# places") : null;
  const tr = trips ? plural(trips, "# trip", "# trips") : null;
  return p && tr ? t`${p} and ${tr}` : (p ?? tr);
};

/** The toast after Undo. A count an older API leaves out reads as zero. */
export function undoToastMessage(result: UndoImportResult): string {
  const removed = nouns(result.deletedPlaces, result.deletedTrips);
  const restored = nouns(result.restoredPlaces, result.restoredTrips);
  const head =
    removed && restored
      ? t`Import undone — ${removed} removed, ${restored} restored.`
      : removed
        ? t`Import undone — ${removed} removed.`
        : restored
          ? t`Import undone — ${restored} restored.`
          : t`Import undone.`;
  const kept = result.keptFields
    ? plural(
        result.keptFields,
        "# field you changed since stays as you left it.",
        "# fields you changed since stay as you left them.",
      )
    : "";
  return [head, kept].filter(Boolean).join(" ");
}
