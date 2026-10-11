import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  copySay,
  copyViolations,
  MAP_MEASURE,
  MAP_MEASURE_START_NOTE,
  MAP_SNAP_OPTIONS,
  mapMeasureVerbs,
  userFacingStrings,
} from "@logjam/shared";

// The words a user reads on Logjam GPS keep the copy rules of
// shared/DESIGN.md §12 (`COPY_RULES` in @logjam/shared): no "Retry", "the app",
// "basemap", "tiles" or "the server", and no Title Case label. The net is JSX
// text, the string props that carry words (`label`, `title`, `message`, …) and
// object properties of those names; a string reaching the user another way
// is a gap in the net, not a licence.
//
// A hit is fixed. One that is legitimate is listed with the reason.
// Mutation that turns it red: set `title` in `ui/RootErrorBoundary.tsx`'s text
// back to "…Restarting the app usually fixes it."
const SRC = join(__dirname);
const APP = join(__dirname, "..", "App.tsx");
// "Name the surface" (§12): where the words mean this client they say Logjam
// GPS. Bare "Logjam" is the service (the account, the server) or the brand, so
// it is listed with the reason rather than banned outright.
const BARE_LOGJAM = /\bLogjam\b(?! (?:GPS|Web|account|GeoPDF)\b)/;
const ALLOWED: { file: string; text: string; reason: string }[] = [
  {
    file: "screens/LandingScreen.tsx",
    text: "Logjam",
    reason: "the wordmark on the sign-in screen",
  },
  {
    file: "screens/AuthFlow.tsx",
    text: "Logjam",
    reason: "the wordmark on the sign-in screen",
  },
  {
    file: "screens/ConsentGate.tsx",
    text: "Logjam",
    reason: "the terms and the agreement are the service's, on both clients",
  },
  {
    file: "screens/settings/NotificationSettingsScreen.tsx",
    text: "Notifications from Logjam",
    reason: "the service sends them, to every client",
  },
  {
    file: "saved/SavedScreen.tsx",
    text: "Couldn't reach Logjam",
    reason: "the service, in our words for a failed request",
  },
  {
    file: "offline/RegionDownloadRow.tsx",
    text: "Logjam couldn't prepare this map",
    reason: "the service clips the map, not this phone",
  },
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
      ? [path]
      : [];
  });
}

describe("copy on Logjam GPS", () => {
  it("reads the strings of the net — a silent zero would pass forever", () => {
    const [first] = userFacingStrings(
      ts,
      "x.tsx",
      'export const a = <Row title="Open it">Hello there</Row>;',
    );
    expect(first.text).toBe("Open it");
  });

  it("names the surface where it means this client", () => {
    const offenders = [...sources(SRC), APP].flatMap((path) =>
      userFacingStrings(ts, path, readFileSync(path, "utf8"))
        .filter(
          ({ text }) =>
            BARE_LOGJAM.test(text) &&
            !ALLOWED.some(
              (a) => relative(SRC, path) === a.file && text.includes(a.text),
            ),
        )
        .map(
          ({ line, text }) =>
            `${relative(SRC, path)}:${line} "${text}" — say Logjam GPS`,
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("breaks no copy rule", () => {
    const offenders = [...sources(SRC), APP].flatMap((path) =>
      userFacingStrings(ts, path, readFileSync(path, "utf8")).flatMap(
        ({ line, text }) =>
          copyViolations(text)
            .filter(
              () =>
                !ALLOWED.some(
                  (a) =>
                    relative(SRC, path) === a.file && text.includes(a.text),
                ),
            )
            .map(
              (id) =>
                `${relative(SRC, path)}:${line} "${text}" — ${copySay(id)}`,
            ),
      ),
    );
    expect(offenders).toEqual([]);
  });

  // The measure tool's words are declared once, in @logjam/shared
  // (`MAP_MEASURE`, `MAP_SNAP_OPTIONS`), and read from there. Mutation: write
  // "Measure distance" back as a literal in `map/MapToolGroup.tsx`.
  it("reads the measure tool's words from the contract", () => {
    const declared = [
      MAP_MEASURE.title,
      MAP_MEASURE.copy.snap,
      MAP_MEASURE.copy.readingTerrain,
      MAP_MEASURE.copy.fromHere,
      MAP_MEASURE_START_NOTE.gps,
      ...mapMeasureVerbs("gps").map((verb) => verb.label),
      ...MAP_SNAP_OPTIONS.map((option) => option.label),
    ].filter((text) => text.length >= 7);
    const offenders = sources(SRC).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return declared
        .filter(
          (text) =>
            source.includes(`"${text}"`) || source.includes(`>${text}<`),
        )
        .map((text) => `${relative(SRC, path)} writes "${text}"`);
    });
    expect(offenders).toEqual([]);
  });
});
