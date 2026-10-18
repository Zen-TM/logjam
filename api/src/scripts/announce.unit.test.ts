import { describe, it, expect, vi } from "vitest";

vi.mock("../services/prisma", () => ({ default: {} }));
vi.mock("../services/push", () => ({ sendPushToUser: vi.fn() }));

import { prepareAnnouncement } from "./announce";

describe("prepareAnnouncement", () => {
  it("takes the first line's heading as the title and the rest as the body", () => {
    expect(
      prepareAnnouncement("\n# New maps\n\nThe **NSW** layer is back.\n"),
    ).toEqual({ title: "New maps", body: "The **NSW** layer is back." });
  });

  // Mutation: stop refusing on `dropped`, so a message the clients would
  // degrade gets sent anyway.
  it("refuses a body that uses anything outside the subset", () => {
    expect(
      prepareAnnouncement("# Hi\n\n<b>bold</b> and ![x](https://e.com/a.png)"),
    ).toEqual({ refused: ["raw HTML", "an image"] });
  });

  // Mutation: take the title from anywhere, or accept Markdown in it.
  it.each([
    ["no heading first", "Hello\n\n# Late title"],
    ["a level-2 title", "## Title\n\nbody"],
    ["no body", "# Title\n"],
    ["Markdown in the title", "# The **new** maps\n\nbody"],
  ])("refuses %s", (_, markdown) => {
    expect(prepareAnnouncement(markdown)).toHaveProperty("refused");
  });
});
