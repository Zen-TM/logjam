import { describe, it, expect } from "vitest";
import { parseMessageMarkdown } from "./announcementMarkdown.js";

const text = (t: string) => ({ type: "text", text: t });

describe("parseMessageMarkdown", () => {
  it("maps the whole subset with nothing dropped", () => {
    // Red if any supported token falls through to the dropped default.
    const { blocks, dropped } = parseMessageMarkdown(
      [
        "# What's new",
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
      { type: "heading", level: 1, children: [text("What's new")] },
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
      "a blockquote",
      "a horizontal rule",
      "a code block",
      "a table",
    ]);
    expect(blocks).toEqual([
      { type: "paragraph", children: [text("alt"), text(" "), text("gone")] },
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

  // Red if levels stay absolute (a body starting at ## skips a level in the
  // dialog) or lose their spacing.
  it("makes the shallowest heading level 1 and keeps the rest relative", () => {
    const { blocks, dropped } = parseMessageMarkdown(
      "## Two\n\n### Three\n\n#### Four\n\n###### Six",
    );
    expect(dropped).toEqual(["more than three levels of heading"]);
    expect(blocks).toEqual([
      { type: "heading", level: 1, children: [text("Two")] },
      { type: "heading", level: 2, children: [text("Three")] },
      { type: "heading", level: 3, children: [text("Four")] },
      { type: "paragraph", children: [text("Six")] },
    ]);
  });

  // Red if a link's text keeps a link of its own: no client can draw that.
  it("flattens a link inside a link to its text and reports it", () => {
    const { blocks, dropped } = parseMessageMarkdown(
      "[see <https://a.example> now](https://b.example)",
    );
    expect(dropped).toEqual(["a link inside a link"]);
    expect(blocks).toEqual([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            href: "https://b.example",
            children: [text("see "), text("https://a.example"), text(" now")],
          },
        ],
      },
    ]);
  });

  // Red if a named entity passes unreported: it would show literally, or
  // bend a link's address.
  it.each(["R&amp;D", "[x](https://e.com/?a=1&amp;b=2)"])(
    "reports a named HTML entity in %s",
    (markdown) => {
      expect(parseMessageMarkdown(markdown).dropped).toEqual([
        "an HTML entity",
      ]);
    },
  );

  // Red if a blank line inside an item is not skipped: valid Markdown would
  // be reported and the item gain an empty line.
  it("keeps a list item's blank-line continuation as one more line", () => {
    const { blocks, dropped } = parseMessageMarkdown("- a\n\n  more\n- b");
    expect(dropped).toEqual([]);
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [[text("a"), { type: "break" }, text("more")], [text("b")]],
      },
    ]);
  });

  // Red if a task list is not reported, or its checkbox survives as text.
  it("reports a task list and drops its checkbox", () => {
    const { blocks, dropped } = parseMessageMarkdown("- [x] done");
    expect(dropped).toEqual(["a task list"]);
    expect(blocks).toEqual([
      { type: "list", ordered: false, start: 1, items: [[text("done")]] },
    ]);
  });
});
