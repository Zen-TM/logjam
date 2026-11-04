import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The band a ChipRail sits in is the kit's (`.rails` in ui/Chip.module.css),
 * so Plans' tabs and Ways' tabs stand at one height. A screen that sets its own
 * padding or gap on `.rails` drifts again.
 *
 * Mutation that turns it red: give any screen's `.rails` a `padding` of its own
 * instead of composing the kit's.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "ui" && dir === SRC ? [] : stylesheets(path);
    return entry.name.endsWith(".module.css") ? [path] : [];
  });
}

describe("the band under a hero that holds a ChipRail", () => {
  it("is composed from the kit, never restyled by a screen", () => {
    const own = stylesheets(SRC)
      .filter((path) =>
        /^\.rails\s*\{(?![^}]*composes: rails from)/m.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map((path) => path.slice(SRC.length + 1));
    expect(own).toEqual([]);
  });
});
