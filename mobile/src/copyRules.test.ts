import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import {
  copySay,
  copyViolations,
  MAP_MEASURE,
  MAP_MEASURE_START_NOTE,
  MAP_SNAP_OPTIONS,
  mapMeasureVerbs,
  serverSentenceParses,
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
    file: "screens/ConsentGate.tsx",
    text: "Logjam",
    reason: "the terms and the agreement are the service's, on both clients",
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

// Strings still to reword to the glossary; delete an entry with its string.
const BASELINE: { file: string; text: string; rule: string }[] = [];

const baselined = (file: string, rule: string, text: string) =>
  BASELINE.some(
    (entry) =>
      entry.file === file && entry.rule === rule && text.includes(entry.text),
  );

/** Every rule a user-facing string breaks, bar what ALLOWED excuses. */
let cached: ReturnType<typeof scan> | undefined;
const hits = () => (cached ??= scan());
function scan() {
  return [...sources(SRC), APP].flatMap((path) =>
    userFacingStrings(ts, path, readFileSync(path, "utf8")).flatMap(
      ({ line, text }) =>
        copyViolations(text)
          .filter(
            () =>
              !ALLOWED.some(
                (a) => relative(SRC, path) === a.file && text.includes(a.text),
              ),
          )
          .map((rule) => ({ file: relative(SRC, path), line, rule, text })),
    ),
  );
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
      ? [path]
      : [];
  });
}

// The scan parses every source file, about a second alone and several under a
// loaded machine, near vitest's 5 s default: it runs in a beforeAll with the
// 30 s `switchCopy.test.ts` gives its own, so no test pays for it whatever
// order they run in.
describe("copy on Logjam GPS", () => {
  beforeAll(() => {
    hits();
  }, 30_000);

  it("reads the strings of the net — a silent zero would pass forever", () => {
    const [first] = userFacingStrings(
      ts,
      "x.tsx",
      'export const a = <Row title="Open it">Hello there</Row>;',
    );
    expect(first.text).toBe("Open it");
  });

  // The words of a confirm are read by the user too, and a string behind a
  // `??`, a ternary, a `+` or a `${}` is still read. Mutation: drop
  // `confirmBody` from COPY_PROPS in shared/src/copyRules.ts, or make `stringOf`
  // stop at the top of the initializer again.
  it("reads a confirm's words wherever they sit in the value", () => {
    const found = userFacingStrings(
      ts,
      "x.ts",
      'const a = { confirmTitle: `Delete ${g.label ?? "this region"}?`, confirmBody: ok ? `The ${k} tiles go.` : "No " + "tiles here.", title: g.label ?? "Offline map region" };',
    ).map(({ text }) => text);
    expect(found.join("|")).toContain("this region");
    expect(found.join("|")).toContain("tiles go");
    expect(found.join("|")).toContain("tiles here");
    expect(found.join("|")).toContain("Offline map region");
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
  }, 30_000);

  // A toast's sentence is passed as the first argument, not a prop. Mutation:
  // drop `COPY_CALLS` from `userFacingStrings` in shared/src/copyRules.ts, and
  // `notify("…the app…")` or `emitToast("…")` anywhere in src/ goes unread.
  it("reads the sentence passed to a toast or an alert", () => {
    const found = userFacingStrings(
      ts,
      "x.ts",
      'notify("Restart the app.", "error"); emitToast(`Saved ${n}`, "done"); toast("Try later"); Alert.alert("Oops", "Sorry about that."); notify(messageFromError(e, "No."));',
    ).map(({ text }) => text);
    expect(found).toEqual([
      "Restart the app.",
      "Saved ",
      "Try later",
      "Oops",
      "Sorry about that.",
    ]);
  });

  it("breaks no copy rule", () => {
    const offenders = hits()
      .filter(({ file, rule, text }) => !baselined(file, rule, text))
      .map(
        ({ file, line, rule, text }) =>
          `${file}:${line} "${text}" — ${copySay(rule)}`,
      );
    expect(offenders).toEqual([]);
  });

  // Mutation: reword one baselined string so it no longer offends.
  it("every baseline entry still offends — the list only shrinks", () => {
    const all = hits();
    const stale = BASELINE.filter(
      (entry) =>
        !all.some(
          ({ file, rule, text }) =>
            file === entry.file &&
            rule === entry.rule &&
            text.includes(entry.text),
        ),
    );
    expect(stale).toEqual([]);
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

  // The API writes its refusals for the user and `messageFromError` shows them
  // as they are (shared/DESIGN.md §11). Mutation: branch on
  // `err.serverMessage?.includes("too large")` anywhere in this client.
  it("never reads into the API's sentence", () => {
    expect(
      serverSentenceParses('if (e.serverMessage?.includes("x")) {}'),
    ).toEqual([1]);
    const offenders = sources(SRC).flatMap((path) =>
      serverSentenceParses(readFileSync(path, "utf8")).map(
        (line) => `${relative(SRC, path)}:${line}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  // A sharee's strips offer no Add and no delete, because the API refuses both
  // (`assertOwnsTarget`). The pure rule is `media/stripOffers.test.ts`; this is
  // the wiring. Mutation: drop `readOnly={!isOwner}` from either strip in
  // `places/PlaceDetailScreen.tsx`.
  it("passes readOnly={!isOwner} to every place media strip", () => {
    const source = readFileSync(
      join(SRC, "places", "PlaceDetailScreen.tsx"),
      "utf8",
    );
    const strips = source.match(/<MediaStrip\b[\s\S]*?\n\s*\/>/g) ?? [];
    expect(strips.length).toBeGreaterThanOrEqual(2);
    for (const strip of strips) expect(strip).toContain("readOnly={!isOwner}");
  });
});
