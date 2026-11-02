import { ApiError } from "./apiErrors.js";
import { tripPlanTripLogStopped } from "./contracts/plans.js";

/**
 * Start a trip log's Next: each picked place (in the plan's order) saved as
 * the caller's copy, skipping those a stopped run already copied (`copies`,
 * plan place id → copy id). It stops at the first failure: `stopped` says
 * what landed and why, and whether to fetch the plan again (the API refused:
 * a place may have left the plan). Both clients run it.
 */
export async function saveTripPlanPlaces(args: {
  picked: readonly { id: string }[];
  copies: Readonly<Record<string, string>>;
  save: (placeId: string) => Promise<{
    id: string;
    mediaSkipped?: number;
    mediaOutOfSpace?: true;
  }>;
  why: (error: unknown) => string;
}): Promise<{
  copies: Record<string, string>;
  /** Copies made by this run. */
  added: number;
  /** Photos this run couldn't bring. */
  skipped: number;
  outOfSpace: boolean;
  stopped: { message: string; error: unknown; refetch: boolean } | null;
}> {
  const copies = { ...args.copies };
  let added = 0;
  let skipped = 0;
  let outOfSpace = false;
  try {
    for (const place of args.picked) {
      if (copies[place.id]) continue;
      const copy = await args.save(place.id);
      copies[place.id] = copy.id;
      added += 1;
      skipped += copy.mediaSkipped ?? 0;
      outOfSpace ||= copy.mediaOutOfSpace === true;
    }
    return { copies, added, skipped, outOfSpace, stopped: null };
  } catch (error) {
    const landed = args.picked.filter((place) => copies[place.id]).length;
    return {
      copies,
      added,
      skipped,
      outOfSpace,
      stopped: {
        message: tripPlanTripLogStopped(landed, args.why(error)),
        error,
        refetch: error instanceof ApiError,
      },
    };
  }
}
