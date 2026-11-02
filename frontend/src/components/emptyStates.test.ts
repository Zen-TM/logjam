import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One empty-state anatomy on the pages a person lands on to do something: a
 * glyph, a title and one sentence under it, then the buttons. A title standing
 * alone (a sentence in bold) is what made Forms and Write-up look unlike
 * Places. The one title-only state kept is a plan that has gone, which has
 * nothing to say and nothing to offer.
 *
 * Mutation that turns it red: delete the `body=` line of any state here.
 */
const DIR = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  "plans/PlansPanel.tsx",
  "plans/PlanDetailPanel.tsx",
  "sidebar/panels/FriendsPanel.tsx",
  "sidebar/panels/NotificationsPanel.tsx",
  "sidebar/panels/TripLogsPanel.tsx",
  "sidebar/panels/PlacesPanel.tsx",
];

describe("an empty state says what is missing and why", () => {
  it.each(PAGES)("%s", (file) => {
    const source = readFileSync(join(DIR, file), "utf8");
    const states =
      source.match(
        /<EmptyState\b(?:[^>]|=>)*?\/>|<EmptyState\b[\s\S]*?\n\s*\/>/g,
      ) ?? [];
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) {
      if (state.includes("TRIP_PLAN_OFFLINE.gone")) continue;
      expect(state).toContain("body=");
    }
  });
});
