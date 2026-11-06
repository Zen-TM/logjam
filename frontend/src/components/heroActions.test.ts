import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every button a hero draws wears one style: the compact filled add. A hero
 * with an outline button beside a filled one on the next page (Friends against
 * Places) is the same slot looking like two things.
 *
 * Mutation that turns it red: set a hero's add (Friends, Place types) back to
 * `variant="outline"`, or drop `compact`.
 */
const DIR = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** Each `<Hero ... />` element: from its opening line to the `/>` that sits at
 *  the same indent, which is how Biome lays a multi-line element out. */
function heroBlocks(source: string): string[] {
  const lines = source.split("\n");
  const blocks: string[] = [];
  lines.forEach((line, start) => {
    const open = /^(\s*)(?:[a-z]+: \()?<Hero$/.exec(line.trimEnd());
    if (!open) return;
    const close = lines.findIndex(
      (each, at) => at > start && each === `${open[1]}/>`,
    );
    blocks.push(lines.slice(start, close + 1).join("\n"));
  });
  return blocks;
}

describe("a hero's buttons", () => {
  const heroes = sources(DIR).flatMap((file) =>
    heroBlocks(readFileSync(file, "utf8")).map((block) => ({ file, block })),
  );

  it("finds the heroes it checks", () => {
    expect(heroes.length).toBeGreaterThan(10);
  });

  it("are compact and filled, never outline or danger", () => {
    for (const { file, block } of heroes) {
      for (const button of block.match(/<Button\b(?:[^>]|=>)*>/g) ?? []) {
        expect(button, file).toContain("compact");
        expect(button, file).toContain('variant="filled"');
      }
    }
  });
});
