// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Nothing the GeoPDF renderer does is logged: a tile index is a coarse
// location and a presigned URL a bearer credential (tiles.ts). This scan is
// the guard. Mutation: add a `console.warn(err)` to any renderer file and it
// goes red.
const DIR = import.meta.dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** Code without its comments, so a comment may say what it must not do. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LOGGING = /\bconsole\s*\.|\blogger\b|\bsafeErrorForLog\b|\bSentry\b/;

describe("GeoPDF renderer privacy", () => {
  it("logs nothing", () => {
    const files = sources(DIR);
    expect(files.length).toBeGreaterThan(8);
    const offenders = files
      .filter((file) => LOGGING.test(code(readFileSync(file, "utf8"))))
      .map((file) => relative(DIR, file));
    expect(offenders).toEqual([]);
  });

  it("sees a console call and ignores one in a comment", () => {
    expect(LOGGING.test(code("console.warn(err);"))).toBe(true);
    expect(
      LOGGING.test(code("// never console.log a tile\nconst a = 1;")),
    ).toBe(false);
  });
});
