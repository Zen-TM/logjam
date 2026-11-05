import { readFileSync } from "node:fs";
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
});
