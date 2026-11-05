import { describe, expect, it } from "vitest";
import { noteBlocks, planWriteUpBlocks } from "./planWriteUp.js";

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

describe("noteBlocks", () => {
  const text = (t: string) => ({ type: "text", text: t });
  const br = { type: "break" };

  it("keeps every line break of a note with no Markdown in it", () => {
    // Red if `breaks` is dropped from the parse: a plain note typed on three
    // lines would run together on one.
    expect(
      noteBlocks("Rope 2 x 60 m\nBring a wetsuit\n\nCar park is full"),
    ).toEqual([
      {
        type: "paragraph",
        children: [text("Rope 2 x 60 m"), br, text("Bring a wetsuit")],
      },
      { type: "paragraph", children: [text("Car park is full")] },
    ]);
  });

  it("draws a heading as a bold line", () => {
    // Red if a heading reaches the clients, where it would rival the section title.
    expect(noteBlocks("# Gear")).toEqual([bold("Gear")]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "//evil.test",
  ])("never links %s", (href) => {
    // Red if the scheme allowlist in parseMessageMarkdown loosens: a note a
    // sharee reads would carry a live script link.
    expect(JSON.stringify(noteBlocks(`[open](${href}) ${href}`))).not.toContain(
      '"type":"link"',
    );
  });

  // Each entry is the text of every block drawn, as typed.
  it.each([
    ["a rule", "Part one\n\n---\n\nPart two", ["Part one", "---", "Part two"]],
    [
      "a setext heading",
      "Part one\n---\nPart two",
      ["Part one\n---", "Part two"],
    ],
    ["an equals underline", "Title\n=====", ["Title\n====="]],
    ["a quote", "> quoted", ["> quoted"]],
    ["a task list", "- [x] wet\n- [ ] rope", ["- [x] wet\n- [ ] rope"]],
    ["strikethrough", "~5km to~10km", ["~5km to~10km"]],
    ["a nested list", "- a\n  - b", ["- a\n  - b"]],
    [
      "hand indentation",
      "a\n  two-space indent\n      six-space indent\nb",
      ["a\n  two-space indent\n      six-space indent\nb"],
    ],
    ["a tab indent", "a\n\tb", ["a\n\tb"]],
    ["an indent in a later paragraph", "a\n\nb\n  c", ["a", "b\n  c"]],
  ])("shows a note with %s exactly as typed", (_name, note, typed) => {
    // Red if a dropped construct is rendered with its characters missing:
    // the author never sees what was lost. Also red if losesIndent is removed:
    // the indented lines come out flush left.
    const blocks = noteBlocks(note);
    expect(
      blocks.map((block) => {
        if (block.type !== "paragraph") throw new Error("not a paragraph");
        return block.children
          .map((c) =>
            c.type === "break" ? "\n" : c.type === "text" ? c.text : "?",
          )
          .join("");
      }),
    ).toEqual(typed);
  });

  it("falls back per block: one unrenderable block leaves the rest drawn", () => {
    // Red if the fallback goes back to covering the whole note: the bold, the
    // list and the heading would be shown as typed because of one quote.
    const blocks = noteBlocks("# Gear\n\n**wet** suit\n\n> quoted\n\n- a\n- b");
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
      "list",
    ]);
    expect(JSON.stringify(blocks[1])).toContain('"type":"strong"');
    expect(JSON.stringify(blocks[2])).not.toContain('"type":"strong"');
  });

  it("still draws Markdown it can fully draw", () => {
    // Red if the fallback fires on a note the subset covers.
    expect(noteBlocks("**a**\n\n- b\n- c").map((b) => b.type)).toEqual([
      "paragraph",
      "list",
    ]);
  });

  it("keeps a list item's indented continuation as a list", () => {
    // Red if losesIndent flags every indented line: a wrapped list item would
    // lose its list drawing.
    expect(noteBlocks("- a\n  more of a\n- b").map((b) => b.type)).toEqual([
      "list",
    ]);
  });

  it("draws raw HTML and an image as text, never as a tree node", () => {
    // Red if an html or image token maps to anything but plain text: a remote
    // image would load for whoever opens the note.
    const blocks = noteBlocks(
      'Hi <img src=x onerror="alert(1)"> ![p](https://x.test/a.png)\n\n<script>x</script>',
    );
    const json = JSON.stringify(blocks);
    expect(json).not.toMatch(/"type":"(image|html|link)"/);
    expect(json).toContain("<script>x</script>");
  });
});
