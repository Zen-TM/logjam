// Narrowing a waypoint list: free-text search plus a tag filter.
//
// Pure and separate from the panel because it is the only logic in it worth a
// test — everything else there is markup and API calls. Mirrors what the mobile
// Saved tab does on its local mirror, so the two behave the same way for the
// same typing.

import type { TWaypoint } from "../../../canyonUtils";

/** A tag and how many waypoints carry it. */
export type TagTally = { tag: string; count: number };

/**
 * Tags in use, most-used first then alphabetical. The vocabulary IS the used
 * values (there is no tag registry), so a tag disappears from the rail when its
 * last waypoint loses it, and the rail can never offer a chip matching nothing.
 */
export function tagTallies(waypoints: TWaypoint[]): TagTally[] {
  const counts = new Map<string, number>();
  for (const waypoint of waypoints) {
    for (const tag of waypoint.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Waypoints matching both the query and the tag. Search covers name, notes and
 * tags — notes are searchable but never rendered in a list row, which is the
 * point of searching them.
 *
 * An empty query and a null tag mean "everything"; the two narrow together.
 */
export function filterWaypoints(
  waypoints: TWaypoint[],
  query: string,
  tag: string | null,
): TWaypoint[] {
  const needle = query.trim().toLowerCase();
  if (!needle && !tag) return waypoints;
  return waypoints.filter((waypoint) => {
    if (tag && !waypoint.tags.includes(tag)) return false;
    if (!needle) return true;
    const haystack = [waypoint.name, waypoint.notes ?? "", ...waypoint.tags]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
