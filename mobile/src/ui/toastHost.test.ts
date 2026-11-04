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
});
