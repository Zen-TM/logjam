import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Back from the offline-map download screen returns where it was opened from
// only if the screen is pushed in the caller's own stack. A cross-tab push
// (`getParent()?.navigate("Map", { screen: "MapRegionDownload" })`) lands Back
// on the other tab.
//
// Mutations that turn it red: make Saved's `onDownloadRegion` navigate
// `getParent()?.navigate("Map", { screen: "MapRegionDownload" })`; or have the
// Plans stack navigate to "MapRegionDownload".
const shell = readFileSync(join(__dirname, "AppShell.tsx"), "utf8");

/** The stack ("Map", "Saved", "More"...) whose navigator holds `index`. */
function stackAt(index: number): string | null {
  for (const open of shell.matchAll(/<(\w+)Stack\.Navigator\b/g)) {
    const close = shell.indexOf(`</${open[1]}Stack.Navigator>`, open.index);
    if (open.index! < index && index < close) return open[1]!;
  }
  return null;
}

describe("the offline-map download screen", () => {
  const calls = [
    ...shell.matchAll(
      /(?<!\.getParent\(\)\?)\.navigate\(\s*"(\w*RegionDownload)"/g,
    ),
  ];

  it("is opened from the Map, Saved and More stacks only", () => {
    expect(calls.map((c) => c[1]).sort()).toEqual([
      "MapRegionDownload",
      "MoreRegionDownload",
      "SavedRegionDownload",
    ]);
  });

  it("is pushed in the stack of the screen that opens it", () => {
    for (const call of calls) {
      const target = call[1]!;
      const stack = stackAt(call.index!);
      expect(target.startsWith(stack ?? "?"), target).toBe(true);
      expect(shell).toMatch(
        new RegExp(String.raw`<${stack}Stack\.Screen\s+name="${target}"`),
      );
    }
  });

  it("is never reached across tabs", () => {
    expect(shell).not.toMatch(/screen:\s*"\w*RegionDownload"/);
  });
});
