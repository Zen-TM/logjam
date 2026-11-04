import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The band a ChipRail sits in is the kit's (`.rails` in ui/Chip.module.css),
 * so every panel's tabs stand at one height. A screen takes it by composing it
 * and adding nothing: its rule is that one declaration.
 *
 * Mutation that turns it red: give any listed `.rails` or `.typeRail` a
 * `padding` or `gap` below its `composes`, replace the `composes` with a
 * padding of its own, or delete the rule (or add a panel to the list without
 * one).
 */
const SRC = dirname(fileURLToPath(import.meta.url));

/** Every screen stylesheet that holds a ChipRail band, with its class. */
const BANDS = [
  "components/plans/plans.module.css:.rails",
  "components/sidebar/panels/AnalyticsPanel.module.css:.rails",
  "components/sidebar/panels/FriendSharingSection.module.css:.rails",
  "components/sidebar/panels/FriendsPanel.module.css:.rails",
  "components/sidebar/panels/NotificationsPanel.module.css:.rails",
  "components/sidebar/panels/PlacesPanel.module.css:.typeRail",
  "components/sidebar/panels/RoutesPanel.module.css:.rails",
  "components/sidebar/panels/TripLogsPanel.module.css:.rails",
];

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "ui" && dir === SRC ? [] : stylesheets(path);
    return entry.name.endsWith(".module.css") ? [path] : [];
  });
}

/** `[file:selector, declarations]` for each `.rails` / `.typeRail` rule. */
function bandRules() {
  return stylesheets(SRC).flatMap((path) =>
    [
      ...readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/(^|\})\s*(\.(?:rails|typeRail))\s*\{([^{}]*)\}/g),
    ].map(
      (m) =>
        [`${path.slice(SRC.length + 1)}:${m[2]}`, m[3].trim()] as [
          string,
          string,
        ],
    ),
  );
}

describe("the band under a hero that holds a ChipRail", () => {
  it("is on exactly the listed screens", () => {
    expect(
      bandRules()
        .map(([key]) => key)
        .sort(),
    ).toEqual([...BANDS].sort());
  });

  it("is the kit's, with nothing added by the screen", () => {
    for (const [key, body] of bandRules())
      expect(body, key).toMatch(
        /^composes: rails from "(\.\.\/)+ui\/Chip\.module\.css";$/,
      );
  });
});
