import { parseMessageMarkdown } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { listMarker, messageSpans } from "./messageSpans";

const spansOf = (markdown: string) => {
  const block = parseMessageMarkdown(markdown).blocks[0];
  if (block.type === "list") throw new Error("not inline");
  return messageSpans(block.children);
};

const plain = { strong: false, em: false, code: false, href: null };

describe("messageSpans", () => {
  // Mutation: build a child's marks from PLAIN instead of the parent's, and
  // the link loses its bold.
  it("keeps the emphasis a run sits inside", () => {
    expect(spansOf("**Read [the notes](https://example.com) now**")).toEqual([
      { ...plain, strong: true, text: "Read " },
      {
        ...plain,
        strong: true,
        href: "https://example.com",
        text: "the notes",
      },
      { ...plain, strong: true, text: " now" },
    ]);
  });

  it("nests italic inside bold", () => {
    expect(spansOf("**a *b***")).toEqual([
      { ...plain, strong: true, text: "a " },
      { ...plain, strong: true, em: true, text: "b" },
    ]);
  });

  it("draws code and a hard break as text", () => {
    expect(spansOf("Run `make dev`  \nthen wait")).toEqual([
      { ...plain, text: "Run " },
      { ...plain, code: true, text: "make dev" },
      { ...plain, text: "\n" },
      { ...plain, text: "then wait" },
    ]);
  });

  // The parser already refuses the scheme; this holds that nothing here
  // turns its leftover text back into a link.
  it("never links what the parser dropped", () => {
    const spans = spansOf("[x](javascript:alert(1))");
    expect(spans.every((s) => s.href === null)).toBe(true);
  });
});

describe("listMarker", () => {
  it("numbers an ordered list from its start", () => {
    const [list] = parseMessageMarkdown("3. a\n4. b").blocks;
    if (list.type !== "list") throw new Error("not a list");
    expect([0, 1].map((i) => listMarker(list, i))).toEqual(["3.", "4."]);
  });

  it("bullets an unordered one", () => {
    const [list] = parseMessageMarkdown("- a").blocks;
    if (list.type !== "list") throw new Error("not a list");
    expect(listMarker(list, 0)).toBe("•");
  });
});
