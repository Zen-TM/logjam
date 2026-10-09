import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Leaving the More tab and coming back shows More's root. Red when the option
// is dropped: the tab would keep whatever page was last open in it. To see it:
// delete `popToTopOnBlur: true` from the More screen's options in AppShell.tsx.
describe("the More tab", () => {
  it("pops its stack to the root when it loses focus", () => {
    const shell = readFileSync(
      new URL("./AppShell.tsx", import.meta.url),
      "utf8",
    );
    const more = shell.slice(shell.indexOf('name="More"'));
    expect(more.slice(0, 600)).toContain("popToTopOnBlur: true");
  });
});
