import { describe, expect, it } from "vitest";
import { planWriteUpBlocks } from "./planWriteUp.js";

const bold = (t: string) => ({
  type: "paragraph",
  children: [{ type: "strong", children: [{ type: "text", text: t }] }],
});

describe("planWriteUpBlocks", () => {
  it("turns every heading level into a bold line, never a heading", () => {
    // Red if a heading reaches the clients, where it would rival the title.
    const blocks = planWriteUpBlocks("# One\n\n## Two\n\ntext", "Gear");
    expect(blocks.some((b) => b.type === "heading")).toBe(false);
    expect(blocks.slice(0, 2)).toEqual([bold("One"), bold("Two")]);
  });

  it("drops a first heading that repeats the title, and only that one", () => {
    expect(planWriteUpBlocks("## gear \n\ntext\n\n## Gear", "Gear")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "text" }] },
      bold("Gear"),
    ]);
  });

  it("keeps bold, italic, links and lists, and draws images and HTML as text", () => {
    const blocks = planWriteUpBlocks(
      "**b** *i* [l](https://example.com)\n\n- a\n- b\n\n![pic](https://x.test/a.png) <b>x</b>",
      "T",
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "list",
      "paragraph",
    ]);
    expect(JSON.stringify(blocks)).not.toMatch(/"type":"(image|html)"/);
    expect(JSON.stringify(blocks[0])).toContain('"type":"link"');
  });
});
