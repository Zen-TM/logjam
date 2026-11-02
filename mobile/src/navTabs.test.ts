import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { navFor, navLabel } from "@logjam/shared";

// Logjam GPS's tab bar is `NAV`'s tabs between Map and More, each wearing its
// `NAV` label. Mutation: swap two `<Tabs.Screen>` blocks in AppShell.tsx, or
// type a tab's word in place of `navLabel(…)`.
describe("the tab bar", () => {
  const shell = readFileSync(
    new URL("./AppShell.tsx", import.meta.url),
    "utf8",
  );
  const tabs = navFor("gps").filter((entry) => entry.tab);

  it("runs Map, the NAV tabs, then More", () => {
    const names = [...shell.matchAll(/<Tabs\.Screen\s+name="(\w+)"/g)].map(
      (match) => match[1],
    );
    const route = (id: string) => id[0].toUpperCase() + id.slice(1);
    expect(names).toEqual(["Map", ...tabs.map((tab) => route(tab.id)), "More"]);
  });

  it("labels each tab from NAV", () => {
    for (const tab of tabs) {
      const from = shell.indexOf(
        `name="${tab.id[0].toUpperCase()}${tab.id.slice(1)}"`,
      );
      expect(shell.slice(from, from + 200)).toContain(
        `tabBarLabel: navLabel("${tab.id}")`,
      );
      expect(navLabel(tab.id)).toBeTruthy();
    }
  });
});
