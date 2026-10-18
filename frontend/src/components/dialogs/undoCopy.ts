import type { UndoImportResult } from "../../placeUtils";

const count = (n: number | undefined, noun: string) =>
  n ? `${n} ${noun}${n === 1 ? "" : "s"}` : null;

const listed = (...items: (string | null)[]) =>
  items.filter((item): item is string => item != null).join(" and ");

/** The toast after Undo. A count an older API leaves out reads as zero. */
export function undoToastMessage(result: UndoImportResult): string {
  const done = [
    listed(
      count(result.deletedPlaces, "place"),
      count(result.deletedTrips, "trip"),
    ),
    listed(
      count(result.restoredPlaces, "place"),
      count(result.restoredTrips, "trip"),
    ),
  ];
  const parts = [
    done[0] && `${done[0]} removed`,
    done[1] && `${done[1]} restored`,
  ].filter(Boolean);
  const kept = !result.keptFields
    ? ""
    : result.keptFields === 1
      ? " 1 field you changed since stays as you left it."
      : ` ${result.keptFields} fields you changed since stay as you left them.`;
  return `${parts.length > 0 ? `Import undone — ${parts.join(", ")}.` : "Import undone."}${kept}`;
}

const CREATED = "Every place and trip this import created is deleted.";
const FINAL = "This can't be undone.";

/** The Undo confirm. `restorableUntil` is the import's deadline for putting
 *  back what it changed, null when it changed nothing it can put back. */
export function undoConfirmMessage(
  restorableUntil: string | null,
  now: Date,
): string {
  if (!restorableUntil) return `${CREATED} ${FINAL}`;
  const until = new Date(restorableUntil);
  if (until > now) {
    return `${CREATED} Places and trips it changed go back to the values they had before it, except fields you've changed since, which stay as you left them. ${FINAL}`;
  }
  const at = until.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${CREATED} Places and trips it changed keep its values: Undo could put them back only until ${at}. ${FINAL}`;
}
