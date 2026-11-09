import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A component's `classes.name` must be a class its CSS module defines: an
 * undefined one is `undefined` at runtime, so the element silently loses its
 * styling, and neither the typecheck nor a render test notices.
 *
 * Mutation: rename `.legendList` in `components/map/LayersPopover.module.css`.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("CSS module classes", () => {
  it("are all defined by the module a component imports", () => {
    const missing: string[] = [];
    for (const file of sources(SRC)) {
      const source = readFileSync(file, "utf8");
      const imports = source.matchAll(
        /import\s+(\w+)\s+from\s+"(\.{1,2}\/[^"]+\.module\.css)"/g,
      );
      for (const [, name, path] of imports) {
        const css = readFileSync(join(dirname(file), path!), "utf8");
        const defined = new Set(
          [...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]),
        );
        const used = source.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, "g"));
        for (const [, cls] of used) {
          if (!defined.has(cls)) missing.push(`${relative(SRC, file)}: ${cls}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
