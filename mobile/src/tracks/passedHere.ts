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
  /** The whole track, so a visit on an overnight track says which day. */
  span: { startMs: number; endMs: number },
  formatterFor: typeof timeOfDayFormatter = timeOfDayFormatter,
): string | null {
  if (passes.length === 0) return null;
  const format = formatterFor(span.startMs, span.endMs);
  const listed = passes.slice(0, MAX_LISTED);
  const isStop = (pass: TrackPass) => pass.toMs - pass.fromMs >= STOP_MS;
  // "at 9:12 am and 3:40 pm" while every visit is a walk past; once one is a
  // stop each says its own word, or it reads "at 12:10 pm to 1:05 pm".
  const mixed = listed.some(isStop);
  const times = listed.map((pass) =>
    isStop(pass)
      ? `from ${format(pass.fromMs)} to ${format(pass.toMs)}`
      : `${mixed ? "at " : ""}${format(pass.atMs)}`,
  );
  const more = passes.length - listed.length;
  if (more > 0) times.push(`${more} more ${more === 1 ? "time" : "times"}`);
  const list =
    times.length === 1
      ? times[0]!
      : `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]!}`;
  if (passes.length === 1 && mixed)
    return `The track was at this point ${list}.`;
  return `This point was passed ${mixed ? "" : "at "}${list}.`;
}
