import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

// A hidden tab does not render (react-freeze): effects and timers go on, React
// state updates wait for the tab to be shown. Red when the option is dropped:
// every hidden tab, the map above all, goes back to re-rendering behind the
// visible one. To see it: delete `freezeOnBlur: true` from the tab navigator's
// screenOptions in AppShell.tsx.
describe("hidden tabs", () => {
  it("are frozen, all five, by the navigator's own screenOptions", () => {
    const shell = read("./AppShell.tsx");
    const navigator = shell.slice(shell.indexOf("<Tabs.Navigator"));
    expect(navigator.slice(0, navigator.indexOf("<Tabs.Screen"))).toContain(
      "freezeOnBlur: true",
    );
    expect(shell).not.toContain("freezeOnBlur: false");
  });
});

// Freezing stops React rendering, so anything that must go on while the Map tab
// is hidden has to live outside a component. Red when one of them imports the
// navigation (a reason to be mounted) or when the recorder's task is no longer
// defined at module level, where TaskManager finds it with no screen mounted.
// To see it: indent the `TaskManager.defineTask` call in trackRecorder.ts into a
// function.
describe("work that outlives the Map tab", () => {
  it.each([
    "./tracks/trackRecorder.ts",
    "./offline/regionDownloadQueue.ts",
    "./offline/regionTileDownload.ts",
  ])("%s does not depend on a mounted screen", (path) => {
    expect(read(path)).not.toMatch(/@react-navigation/);
  });

  it("keeps the recorder's task defined at module level", () => {
    expect(read("./tracks/trackRecorder.ts")).toMatch(
      /^TaskManager\.defineTask/m,
    );
  });

  // The blur render must reach the map so its sensor effects clean up before
  // the freeze lands; they hang off `useIsFocused` for that reason.
  it("still ends the map's sensors on blur", () => {
    const map = read("./map/MapScreen.tsx");
    expect(map).toContain("const mapFocused = useIsFocused();");
    expect(map).toContain("const sensorsActive = mapFocused && appActive;");
  });
});
