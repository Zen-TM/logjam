import type { MediaCategory } from "./media.js";
import { plural, t } from "./i18n.js";

/** "2 photos": how many of one kind went in. */
function countOf(category: MediaCategory | null, n: number): string {
  switch (category) {
    case "image":
      return plural(n, "# photo", "# photos");
    case "video":
      return plural(n, "# video", "# videos");
    case "track":
      return plural(n, "# route", "# routes");
    default:
      return plural(n, "# file", "# files");
  }
}

/** "2 photos and 1 video": what went in, by kind, in the order picked. */
function whatWasAdded(added: readonly (MediaCategory | null)[]): string {
  const counts = new Map<MediaCategory | null, number>();
  for (const category of added)
    counts.set(category, (counts.get(category) ?? 0) + 1);
  return [...counts].map(([category, n]) => countOf(category, n)).join(" and ");
}

/**
 * One line for a whole pick of files, the same on both clients: what went in,
 * and how many didn't. `added` is the kind of each file that went in. A single
 * file that fails keeps the single-file wording; nothing to say when nothing
 * was picked.
 *
 * `failuresListed`: the surface already lists each failure where the user is
 * looking (Logjam Web's list under the dropzone), and a failure has one place.
 * The line then says only what went in, and nothing when nothing did.
 */
export function attachSummary(
  added: readonly (MediaCategory | null)[],
  failed: number,
  { failuresListed = false }: { failuresListed?: boolean } = {},
): { message: string; tone: "done" | "error" } | null {
  const total = added.length + failed;
  if (total === 0) return null;
  if (failuresListed)
    return added.length === 0
      ? null
      : { message: t`${whatWasAdded(added)} added.`, tone: "done" };
  if (failed === 0)
    return { message: t`${whatWasAdded(added)} added.`, tone: "done" };
  if (total === 1)
    return { message: t`That file couldn't be attached.`, tone: "error" };
  if (added.length === 0)
    return { message: t`Couldn't add any of the ${total}.`, tone: "error" };
  return {
    message: t`${added.length} of ${total} added. ${failed} couldn't be added.`,
    tone: "error",
  };
}
