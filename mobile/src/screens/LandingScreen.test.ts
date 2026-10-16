// A file app.json hands to an icon pipeline is never registered in the
// embedded asset map, so a screen that requires it renders nothing in a
// release build while debug looks fine.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, path), "utf8");

describe("LandingScreen's logo", () => {
  // Mutation: point the logo's require at assets/icon.png.
  it("is not a file app.json claims for an icon or splash", () => {
    const [, logo] =
      /require\("\.\.\/\.\.\/assets\/([^"]+)"\)/.exec(
        read("LandingScreen.tsx"),
      ) ?? [];
    const claimed = [
      ...read("../../app.json").matchAll(/"\.\/assets\/([^"]+)"/g),
    ].map(([, file]) => file);

    expect(logo).toBe("logo.png");
    expect(claimed).toContain("icon.png");
    expect(claimed).not.toContain(logo);
  });
});
