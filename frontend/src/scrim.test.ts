import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * shared/DESIGN.md §7: a black veil is `--scrim-light`, `--scrim-heavy` or
 * `--scrim-photo` (generated from the shared SCRIM), never a black with its own
 * alpha. A shadow is not a veil and keeps its own.
 *
 * Mutation that turns it red: write `background: rgba(0, 0, 0, 0.5);` in any
 * stylesheet outside a `--shadow-*` declaration.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith(".css") && !entry.name.endsWith(".generated.css")
      ? [path]
      : [];
  });
}

describe("black veils", () => {
  it("come only from the generated scrim properties", () => {
    const offenders = stylesheets(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter(
          (line) =>
            /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/.test(line) &&
            !line.includes("--shadow-") &&
            !/box-shadow|text-shadow/.test(line),
        )
        .map((line) => `${file.slice(SRC.length + 1)}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
