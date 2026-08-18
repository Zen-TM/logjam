import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// EVERY <Layer> NEEDS A `key`, AND THE CRASH IF IT DOESN'T IS FULL-SCREEN.
//
// MLRN 11 freezes a layer's id on first render (`useFrozenId`) and THROWS
// "`id` cannot be changed" if the same fiber is later rendered with a different
// one. On its own that is harmless — our ids are constants. The trap is that
// MLRN's `cloneReactChildrenWithProps` FILTERS FALSY CHILDREN OUT before
// `Children.map`, so a conditional layer does not hold its slot:
//
//   <GeoJSONSource>
//     {heading != null ? <Layer id="user-location-heading" /> : null}
//     <Layer id="user-location-dot" />
//   </GeoJSONSource>
//
// With no heading the dot is child 0; when a heading arrives the beam becomes
// child 0 and the dot becomes child 1. Keyless siblings of the same type
// reconcile BY INDEX, so React reuses the dot's fiber for the beam, the id
// changes underneath it, and the throw takes the whole app to the root error
// boundary. Observed on device: press locate, switch tabs, "Something went
// wrong".
//
// A `key` equal to the id makes the reconciliation key-based, so a fiber can
// never be reused across two ids. It costs nothing on the layers that are not
// conditional today and removes the trap for the ones that become conditional
// tomorrow — which is why this test covers ALL of them rather than the two that
// were actually broken.
const SRC = join(__dirname, "..");

function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFilesUnder(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** Self-closing `<Layer … />` elements, with their prop text. */
function layerElements(source: string): string[] {
  return [...source.matchAll(/<Layer\b[\s\S]*?\/>/g)].map((match) => match[0]);
}

describe("every MLRN Layer carries a key", () => {
  const files = tsxFilesUnder(SRC).filter((path) =>
    layerElements(readFileSync(path, "utf8")).length > 0,
  );

  it("finds the layers at all — a silent zero would pass forever", () => {
    // Guards the regex against an MLRN rename: if <Layer> ever becomes
    // something else, this fails loudly instead of vacuously passing.
    expect(files.length).toBeGreaterThan(0);
    const total = files.reduce(
      (count, path) => count + layerElements(readFileSync(path, "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(30);
  });

  it.each(files)("%s", (path) => {
    const offenders = layerElements(readFileSync(path, "utf8")).filter(
      (element) => !/(^|\s)key=/.test(element),
    );
    expect(offenders).toEqual([]);
  });
});
