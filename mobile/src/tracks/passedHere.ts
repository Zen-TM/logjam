// The one line a track's sheet says about the spot that was tapped to open it.
import type { TrackPass } from "@logjam/shared";

// Not the kit barrel: it pulls in React Native, and this file is tested in node.
import { timeOfDayFormatter } from "../ui/profileSeries";

/** A visit shorter than this is a walk past: one time says it. */
const STOP_MS = 5 * 60_000;
/** Laps of one loop would otherwise fill the sheet with times. */
const MAX_LISTED = 4;

export function passedHereText(
  passes: readonly TrackPass[],
  formatterFor: typeof timeOfDayFormatter = timeOfDayFormatter,
): string | null {
  if (passes.length === 0) return null;
  const format = formatterFor(
    passes[0]!.fromMs,
    passes[passes.length - 1]!.toMs,
  );
  const times = passes
    .slice(0, MAX_LISTED)
    .map((pass) =>
      pass.toMs - pass.fromMs >= STOP_MS
        ? `${format(pass.fromMs)} to ${format(pass.toMs)}`
        : format(pass.atMs),
    );
  const more = passes.length - times.length;
  if (more > 0) times.push(`${more} more ${more === 1 ? "time" : "times"}`);
  const list =
    times.length === 1
      ? times[0]!
      : `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]!}`;
  // "from … to …" for a lone stop reads better than "at … to …".
  return passes.length === 1 && times[0]!.includes(" to ")
    ? `The track was at this point from ${list}.`
    : `This point was passed at ${list}.`;
}
