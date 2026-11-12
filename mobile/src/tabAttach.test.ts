import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The tab navigator keeps hidden tabs attached. With the default, an inactive
// tab's native view tree is detached and re-attached whole on every switch
// (react-native-screens), which was the 220-330 ms mount batch on a tab switch.
// `freezeOnBlur` is no use beside it: react-native-screens only freezes the
// screens it detaches, so the option would sit there doing nothing.
// Red when the prop is dropped or only mentioned in a comment. To see it:
// delete `detachInactiveScreens={false}` from the tab navigator in AppShell.tsx.
describe("hidden tabs", () => {
  const code = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("stay attached", () => {
    const navigator = code.slice(code.indexOf("<Tabs.Navigator"));
    const opening = navigator.slice(0, navigator.indexOf("<Tabs.Screen"));
    expect(opening).toMatch(/^\s*detachInactiveScreens=\{false\}$/m);
  });

  it("do not carry a freeze option that would be ignored", () => {
    expect(code).not.toMatch(/freezeOnBlur/);
  });

  // bottom-tabs layers its scenes with `zIndex: isFocused ? 0 : -1`. Flipping
  // it on a switch re-orders the siblings, and Fabric mounts that as a REMOVE
  // and INSERT of each moved tab's native tree, the map's included (a 200-330
  // ms batch on the S9). The patch drops it; an inactive scene is display:none
  // and needs no layering. patch-package refuses a patch that no longer
  // applies, but not an install where postinstall never ran, so check the
  // installed source. Red when the patch is missing or an upgrade drops it.
  // To see it: delete patches/@react-navigation+bottom-tabs+*.patch and reinstall.
  it("are not re-layered by a zIndex flip", () => {
    const source = readFileSync(
      join(
        __dirname,
        "../node_modules/@react-navigation/bottom-tabs/lib/module/views/BottomTabView.js",
      ),
      "utf8",
    );
    expect(
      source,
      "patches/@react-navigation+bottom-tabs did not apply",
    ).toContain("LOGJAM PATCH");
    expect(source).not.toMatch(/zIndex:\s*isFocused/);
  });
});
