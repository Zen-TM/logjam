import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("..", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

// Uppercase is for a heading, a stat caption or the hero's eyebrow: never for
// the label of a field or a control (shared/DESIGN.md §2; `fieldLabel`).
// `theme.ts` draws it once, as the `section` type role that SectionHeader, Hero
// and StatGrid spread; the files below it are the rest of the places allowed to
// set it. Red when a new file sets `textTransform: "uppercase"`: a field label
// there would read as a second section heading. To see it: add that style to
// `ui/TextField.tsx`.
const MAY_SHOUT = [
  "theme.ts",
  "screens/NotificationsScreen.tsx", // the day heading
  "routes/RouteStatsBody.tsx", // chart caption
  "tracks/TrackStatsBody.tsx",
];

describe("uppercase text", () => {
  it("is set only where a heading or a caption is", () => {
    const shouting = sources(SRC)
      .filter((path) =>
        /textTransform:\s*"uppercase"/.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(SRC, path))
      .sort();
    expect(shouting).toEqual([...MAY_SHOUT].sort());
  });
});
