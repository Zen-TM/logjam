// A date a user reads is written by `dateFormat.ts`, so Logjam's language picks its
// order and its names. `toLocaleDateString` and `dateStyle` follow the device's
// locale, not Logjam's language. The one use left is an en-CA date key in the API,
// which is a sortable key, not text.
//
// Mutation that turns it red: write `toLocaleDateString("en-AU")` in any source
// file under shared, frontend, mobile or api, or list one in ALLOWED.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..", "..");
const PACKAGES = ["shared/src", "frontend/src", "mobile/src", "api/src"];
const TEST_FILE = /\.test\.tsx?$|(^|\/)__(tests|fixtures|mocks)__\//;
const RUNTIME_DATE = /toLocaleDateString\(|\bdateStyle\b/;

/** Files whose use is not text a user reads: the reason is beside each. */
const ALLOWED: Record<string, string> = {
  "api/src/lib/tripPlanView.ts":
    'a YYYY-MM-DD key, `toLocaleDateString("en-CA"`',
};

function sources(dir: string): string[] {
  return readdirSync(join(repo, dir), { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory())
      return e.name === "node_modules" || e.name === "dist"
        ? []
        : sources(path);
    return /\.tsx?$/.test(e.name) && !TEST_FILE.test(path) ? [path] : [];
  });
}

const scanned = PACKAGES.flatMap(sources);
const using = scanned.filter((path) =>
  RUNTIME_DATE.test(readFileSync(join(repo, path), "utf8")),
);

describe("dates written in the device's locale", () => {
  // Mutation: scan one package fewer, or let the pattern stop matching.
  it("reads the sources, and finds the one allowed use", () => {
    expect(scanned.length).toBeGreaterThanOrEqual(1000);
    expect(using).toContain("api/src/lib/tripPlanView.ts");
  });

  // Mutation: write `toLocaleDateString(` in any source file but the allowed one.
  it("are written nowhere but where ALLOWED says", () => {
    expect(
      using.sort(),
      "Write a date with a function of shared/src/dateFormat.ts (formatDayMonthYear, formatLongMonthYear, …), never toLocaleDateString or a dateStyle: those follow the device's locale, not Logjam's language. The one allowed use is an en-CA date key, listed in ALLOWED.",
    ).toEqual(Object.keys(ALLOWED).sort());
  });
});
