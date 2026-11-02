import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { ApiError, AUTH_ERROR_CODES, messageFromError } from "./apiErrors.js";
import * as contracts from "./contracts/index.js";
import { copySay, copyViolations, userFacingStrings } from "./copyRules.js";

// Every string a screen contract declares keeps the copy rules of
// shared/DESIGN.md §12: no "Retry", no "the app", no "basemap", "tiles" or "the
// server", no Title Case label. A hit is fixed; the clients' own scans
// (`copyRules.test.ts` in each) take an allow-list with a reason.
//
// Mutation that turns it red: set `tabBasemap` in `contracts/mapLayers.ts`
// back to "Basemap".

/** Keys that hold an identifier or a note for developers, not words a user reads. */
const NOT_COPY = new Set([
  "id",
  "key",
  "reason",
  "gap",
  "on",
  "question",
  "icon",
]);

function strings(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value))
    value.forEach((item, index) => strings(item, `${path}[${index}]`, out));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value))
      if (!NOT_COPY.has(key)) strings(item, `${path}.${key}`, out);
}

/** Every string a contract's functions return for a count or a name. */
function fromFunctions(out: [string, string][]): void {
  for (const [name, value] of Object.entries(contracts)) {
    if (typeof value !== "function") continue;
    for (const arg of [0, 1, 3, "Ranon"]) {
      try {
        const result = (value as (a: unknown) => unknown)(arg);
        if (typeof result === "string") out.push([`${name}(${arg})`, result]);
      } catch {
        // Not a function of one count or one name.
      }
    }
  }
}

describe("contract copy", () => {
  const all: [string, string][] = [];
  for (const [name, value] of Object.entries(contracts)) {
    if (typeof value !== "function") strings(value, name, all);
  }
  fromFunctions(all);

  it("reads strings at all — a silent zero would pass forever", () => {
    expect(all.length).toBeGreaterThan(500);
  });

  it("recognises what it forbids", () => {
    expect(copyViolations("Retry")).toEqual(["retry"]);
    expect(copyViolations("Use the app")).toEqual(["the-app"]);
    expect(copyViolations("Mark All Read")).toEqual(["title-case"]);
    expect(copyViolations("Mark all as read")).toEqual([]);
    expect(copyViolations("Logjam GPS")).toEqual([]);
    expect(copyViolations("Finished GeoPDFs")).toEqual([]);
  });

  // One line a rule must flag and one it must leave alone, per rule of the
  // glossary and the error register. Mutation: loosen any pattern to `/./`,
  // or narrow it to nothing.
  it.each([
    ["please", "Please try again.", "Couldn't save this place."],
    ["cannot", "We cannot do that.", "We can't do that."],
    ["that-didnt-work", "That didn't work.", "Couldn't save this place."],
    ["curly-apostrophe", "Couldn’t save.", "Couldn't save."],
    ["waypoint", "Add a waypoint", "Add a place"],
    ["custom-field", "Edit custom fields", "Edit attributes"],
    ["logbook", "Your logbook", "Your trips"],
    ["trip-log", "Start a trip log", "Log a trip"],
    ["activity", "By activity", "By trip type"],
    ["lidar-topo", "Make a LiDAR topo", "Make a sharpened area"],
    ["lidar-topo", "Open the topo", "Open the sharpened area"],
    ["region", "Download a map region", "Save an offline map"],
    ["unshare", "Unshare", "Stop sharing"],
    ["recipients", "Visible to recipients", "Friends you pick can see it"],
    ["turn-down", "Turn down", "Decline"],
    ["turn-down", "Let in", "Accept"],
    ["attach-to-place", "Attach to a place", "Link to a place"],
  ])("flags %s in %j and passes %j", (id, bad, good) => {
    expect(copyViolations(bad)).toContain(id);
    expect(copyViolations(good)).not.toContain(id);
  });

  // One word, then a name: the name's own capital makes it read as Title
  // Case ("Join Ranon"). Mutation: empty this set, and the title is flagged.
  const verbThenName = new Set(["tripPlanJoinTitle(Ranon)"]);

  it("breaks no copy rule", () => {
    const offenders = all
      .filter(([path]) => !verbThenName.has(path))
      .flatMap(([path, text]) =>
        copyViolations(text).map((id) => `${path}: "${text}" — ${copySay(id)}`),
      );
    expect(offenders).toEqual([]);
  });
});

describe("the words an API failure shows", () => {
  it("break no copy rule", () => {
    const messages = [400, 401, 403, 404, 409, 429, 500, 502, 503].map((s) =>
      messageFromError(new ApiError(s, "/x", "GET"), "Couldn't do that."),
    );
    messages.push(
      messageFromError(new TypeError("Failed to fetch"), "fallback"),
      messageFromError(new Error("Network Error"), "fallback"),
    );
    expect(messages.flatMap(copyViolations)).toEqual([]);
  });
});

// The words in shared/src outside contracts/ (labels, notification text, the
// error sentences) keep the same rules as the contracts and the clients, with
// no allow-list: a hit is fixed here. Mutation that turns it red: put "Please"
// back into `STATUS_MESSAGES[401]` in `apiErrors.ts`.
describe("shared copy outside contracts/", () => {
  const SRC = dirname(fileURLToPath(import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory())
        return entry.name === "contracts" ? [] : files(path);
      return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
        ? [path]
        : [];
    });
  const scanned = files(SRC);

  it("reads files at all — a silent zero would pass forever", () => {
    expect(scanned.length).toBeGreaterThan(40);
  });

  it("breaks no copy rule", () => {
    const offenders = scanned.flatMap((path) =>
      userFacingStrings(ts, path, readFileSync(path, "utf8")).flatMap((found) =>
        copyViolations(found.text).map(
          (id) =>
            `${relative(SRC, path)}:${found.line}: "${found.text}" — ${copySay(id)}`,
        ),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every sign-in and failure message to the register", () => {
    const messages = [
      ...Object.values(AUTH_ERROR_CODES),
      ...Array.from({ length: 200 }, (_, i) =>
        messageFromError(
          new ApiError(400 + i, "/x", "GET"),
          "Couldn't do that.",
        ),
      ),
      messageFromError(new TypeError("Failed to fetch"), "fallback"),
    ];
    expect(messages.flatMap(copyViolations)).toEqual([]);
  });
});
