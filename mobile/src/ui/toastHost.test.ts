import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(__dirname, "..");
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });

describe("toasts have one host and one anchor", () => {
  // Mutation: drop `<ToastHost />` from AppShell, and every toast falls back to
  // drawing in its own screen, where the tab bar and the map's instruments
  // each moved it a different way.
  it("mounts ToastHost once, in AppShell", () => {
    const shell = readFileSync(join(src, "AppShell.tsx"), "utf8");
    expect(shell.match(/<ToastHost \/>/g)).toHaveLength(1);
  });

  // Mutation: drop `<ToastHost />` from BottomSheet, and a toast raised
  // while a sheet is open (copying the position) is drawn under its native
  // Modal, where nobody sees it. The routing is held by toastStore.test.ts.
  it("mounts one more ToastHost inside BottomSheet's Modal, and nowhere else", () => {
    const hosts = sources(src).filter((file) =>
      /<ToastHost[ />]/.test(readFileSync(file, "utf8")),
    );
    expect(hosts.map((file) => file.slice(src.length + 1)).sort()).toEqual([
      "AppShell.tsx",
      join("ui", "BottomSheet.tsx"),
    ]);
    expect(readFileSync(join(src, "ui", "BottomSheet.tsx"), "utf8")).toContain(
      "<ToastHost />",
    );
  });

  // Mutation: draw a toast pill in a screen (a second use of `toastGlyph`)
  // instead of raising it through `<Toast>`.
  it("draws the pill only in ui/Toast.tsx", () => {
    const drawers = sources(src).filter((file) =>
      readFileSync(file, "utf8").includes("toastGlyph("),
    );
    expect(drawers.map((file) => file.slice(src.length + 1))).toEqual([
      join("ui", "Toast.tsx"),
    ]);
  });

  // Mutation: pass `bottom={…}` or `inset={…}` to a `<Toast>` (as the map once
  // did to clear its instruments), or give `Toast`/`ToastHost` a prop that
  // moves the dock, and the toast sits somewhere new on that screen.
  it("lets no screen, sheet or host place a toast", () => {
    const placed = sources(src).filter((file) =>
      /<Toast(Host)?\b[^>]*\b(bottom|inset|sheet)=/s.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(placed).toEqual([]);
    const toast = readFileSync(join(src, "ui", "Toast.tsx"), "utf8");
    expect(toast).not.toMatch(/\b(Clearance|dockBottom)\b/);
    expect(toast.match(/useTabBarHeight\(\)/g)).toHaveLength(1);
  });
});
