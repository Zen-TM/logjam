import type { MediaCategory } from "./media.js";

const NOUN: Record<MediaCategory, string> = {
  image: "photo",
  video: "video",
  track: "route",
};

/** "2 photos and 1 video": what went in, by kind, in the order picked. */
function whatWasAdded(added: readonly (MediaCategory | null)[]): string {
  const counts = new Map<string, number>();
  for (const category of added) {
    const noun = category ? NOUN[category] : "file";
    counts.set(noun, (counts.get(noun) ?? 0) + 1);
  }
  return [...counts]
    .map(([noun, n]) => `${n} ${noun}${n === 1 ? "" : "s"}`)
    .join(" and ");
}

/**
 * One line for a whole pick of files, the same on both clients: what went in,
 * and how many didn't. `added` is the kind of each file that went in. A single
 * file that fails keeps the single-file wording; nothing to say when nothing
 * was picked.
 */
export function attachSummary(
  added: readonly (MediaCategory | null)[],
  failed: number,
): { message: string; tone: "done" | "error" } | null {
  const total = added.length + failed;
  if (total === 0) return null;
  if (failed === 0)
    return { message: `${whatWasAdded(added)} added.`, tone: "done" };
  if (total === 1)
    return { message: "That file couldn't be attached.", tone: "error" };
  if (added.length === 0)
    return { message: `Couldn't add any of the ${total}.`, tone: "error" };
  return {
    message: `${added.length} of ${total} added. ${failed} couldn't be added.`,
    tone: "error",
  };
}
