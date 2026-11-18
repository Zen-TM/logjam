import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A tab with no `tabBarLabel` shows its route name, which is code and never
// reaches the catalogue (ADR 0050), so the coverage scanner cannot see it.
// Red when a tab drops its label or hard-codes it. To see it: delete
// `tabBarLabel` from the Map screen's options in AppShell.tsx, or write it as
// `tabBarLabel: "Map"`.
describe("the tab bar", () => {
  const code = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const screens = code.split("<Tabs.Screen").slice(1);

  it("labels every tab through the catalogue, not by its route name", () => {
    expect(screens.length).toBeGreaterThanOrEqual(5);
    for (const screen of screens) {
      const name = screen.match(/name="([^"]+)"/)?.[1];
      const options = screen.slice(0, screen.indexOf("</Tabs.Screen>"));
      expect(options, `tab ${name}`).toMatch(/tabBarLabel:\s*(t`|navLabel\()/);
    }
  });
});
