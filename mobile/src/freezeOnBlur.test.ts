import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

// Which tabs freeze when hidden: exactly Places, Logs and Saved. A frozen tab
// does not render (react-freeze) while its effects and timers go on. The Map
// stays live (null camera refs while frozen, sheets that cannot close, a
// catch-up render in the switch back) and More stays live so its pop to root
// reaches the stack before it hides. Red when a tab's option is dropped,
// flipped or only mentioned in a comment. To see it: delete `freezeOnBlur:
// true,` from the Places options in AppShell.tsx, or set it true on the Map.
describe("hidden tabs", () => {
  it("freeze exactly Places, Logs and Saved", () => {
    const code = read("./AppShell.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const navigator = code.slice(code.indexOf("<Tabs.Navigator"));
    const screens = [...navigator.matchAll(/<Tabs\.Screen\s+name="(\w+)"/g)];
    const frozen: Record<string, boolean | undefined> = {};
    screens.forEach((match, i) => {
      const end = screens[i + 1]?.index ?? navigator.length;
      const own = navigator.slice(match.index, end);
      const flag = own.match(/^\s*freezeOnBlur: (true|false),$/m);
      frozen[match[1]] = flag ? flag[1] === "true" : undefined;
    });
    expect(frozen).toEqual({
      Map: false,
      Places: true,
      Logs: true,
      Saved: true,
      More: false,
    });
  });
});
