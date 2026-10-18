import { describe, it, expect } from "vitest";
import { parseMessageMarkdown } from "./announcementMarkdown.js";

const text = (t: string) => ({ type: "text", text: t });

describe("parseMessageMarkdown", () => {
  it("maps the whole subset with nothing dropped", () => {
    // Red if any supported token falls through to the dropped default.
    const { blocks, dropped } = parseMessageMarkdown(
      [
        "## What's new",
        "",
        "Some **bold**, *italic*, `code` and a [link](https://example.com).  ",
        "Next line.",
        "",
        "- one",
        "- two",
        "",
        "3. three",
        "4. [mail](mailto:someone@example.com)",
      ].join("\n"),
    );
    expect(dropped).toEqual([]);
    expect(blocks).toEqual([
      { type: "heading", level: 2, children: [text("What's new")] },
      {
        type: "paragraph",
        children: [
          text("Some "),
          { type: "strong", children: [text("bold")] },
          text(", "),
          { type: "em", children: [text("italic")] },
          text(", "),
          { type: "code", text: "code" },
          text(" and a "),
          {
            type: "link",
            href: "https://example.com",
            children: [text("link")],
          },
          text("."),
          { type: "break" },
          text("Next line."),
        ],
      },
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [[text("one")], [text("two")]],
      },
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [
          [text("three")],
          [
            {
              type: "link",
              href: "mailto:someone@example.com",
              children: [text("mail")],
            },
          ],
        ],
      },
    ]);
  });

  it("turns a soft line break into a space", () => {
    // Red if text keeps its "\n": Logjam GPS's Text would break the line.
    expect(parseMessageMarkdown("a\nb").blocks).toEqual([
      { type: "paragraph", children: [text("a b")] },
    ]);
  });

  it("keeps raw HTML as its literal text and reports it", () => {
    // Red if html maps to anything but plain text, or is not reported.
    const { blocks, dropped } = parseMessageMarkdown(
      'Hi <img src=x onerror="alert(1)">\n\n<div>block</div>',
    );
    expect(dropped).toEqual(["raw HTML"]);
    expect(blocks).toEqual([
      {
        type: "paragraph",
        children: [text("Hi "), text('<img src=x onerror="alert(1)">')],
      },
      { type: "paragraph", children: [text("<div>block</div>")] },
    ]);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,x",
    "/relative",
  ])("unlinks %s and reports it", (href) => {
    // Red if the scheme allowlist loosens or stops being anchored.
    const { blocks, dropped } = parseMessageMarkdown(`[click](${href})`);
    expect(dropped).toEqual(["a link that isn't https, http or mailto"]);
    expect(blocks).toEqual([{ type: "paragraph", children: [text("click")] }]);
  });

  it("degrades everything outside the subset to text, each reported", () => {
    // Red if any of these maps to a block or inline of its own.
    const { blocks, dropped } = parseMessageMarkdown(
      [
        "![alt](https://example.com/a.png) ~~gone~~",
        "",
        "#### Deep",
        "",
        "> quoted",
        "",
        "---",
        "",
        "```",
        "line 1",
        "line 2",
        "```",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
      ].join("\n"),
    );
    expect(dropped).toEqual([
      "an image",
      "strikethrough",
      "a heading below level 3",
      "a blockquote",
      "a horizontal rule",
      "a code block",
      "a table",
    ]);
    expect(blocks).toEqual([
      { type: "paragraph", children: [text("alt"), text(" "), text("gone")] },
      { type: "paragraph", children: [text("Deep")] },
      { type: "paragraph", children: [text("quoted")] },
      {
        type: "paragraph",
        children: [text("line 1"), { type: "break" }, text("line 2")],
      },
      {
        type: "paragraph",
        children: [
          text("| a | b |"),
          { type: "break" },
          text("|---|---|"),
          { type: "break" },
          text("| 1 | 2 |"),
        ],
      },
    ]);
  });

  it("flattens a nested list into its parent item and reports it", () => {
    // Red if the list tree goes deeper than one level.
    const { blocks, dropped } = parseMessageMarkdown("- a\n  - b\n  - c");
    expect(dropped).toEqual(["a nested list"]);
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [
          [
            text("a"),
            { type: "break" },
            text("b"),
            { type: "break" },
            text("c"),
          ],
        ],
      },
    ]);
  });

  it("reports a task list and drops its checkbox", () => {
    const { blocks, dropped } = parseMessageMarkdown("- [x] done");
    expect(dropped).toEqual(["a task list"]);
    expect(blocks).toEqual([
      { type: "list", ordered: false, start: 1, items: [[text("done")]] },
    ]);
  });
});
