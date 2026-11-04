// A plan section's text is Markdown under the section's own title, so a
// heading in it must never look like a second title. The tree is the
// announcements' (`parseMessageMarkdown`): paragraphs, bold, italic, code,
// links (https, http, mailto) and lists. Images, HTML, tables and code blocks
// come out as plain text. Guard: planWriteUp.test.ts.
import {
  parseMessageMarkdown,
  type MessageBlock,
  type MessageInline,
} from "./announcementMarkdown.js";

const plainText = (inlines: MessageInline[]): string =>
  inlines
    .map((i) =>
      i.type === "text" || i.type === "code"
        ? i.text
        : i.type === "break"
          ? " "
          : plainText(i.children),
    )
    .join("")
    .trim()
    .toLowerCase();

/**
 * The blocks to draw under `title`: every heading becomes a bold line, and a
 * first heading that repeats the title is dropped.
 */
export function planWriteUpBlocks(body: string, title: string): MessageBlock[] {
  const { blocks } = parseMessageMarkdown(body);
  const [first, ...rest] = blocks;
  const kept =
    first?.type === "heading" &&
    plainText(first.children) === title.trim().toLowerCase()
      ? rest
      : blocks;
  return boldHeadings(kept);
}

/** A heading in text under someone's own title is a bold line instead. */
export function boldHeadings(blocks: MessageBlock[]): MessageBlock[] {
  return blocks.map((block) =>
    block.type === "heading"
      ? {
          type: "paragraph",
          children: [{ type: "strong", children: block.children }],
        }
      : block,
  );
}

// A line of only dashes or equals under text is a setext heading, which
// `dropped` doesn't report; on its own it is a rule, which it does.
const UNDERLINE = /^ {0,3}(-+|=+)[ \t]*$/m;

// Markdown drops a line's leading spaces, so a hand-indented line would come
// out flush left. Only a list item's continuation may be indented: its
// indent is the list's own.
function losesIndent(notes: string): boolean {
  let inItem = false;
  return notes.split("\n").some((line) => {
    if (!line.trim()) return false;
    if (/^[ \t]/.test(line)) return !inItem;
    inItem = /^(?:[-*+]|\d+[.)])[ \t]/.test(line);
    return false;
  });
}

/**
 * The blocks to draw for a place's or a trip's free-text notes: the same
 * Markdown subset, every line break kept. A note is shown as typed, so one
 * that uses anything the subset cannot draw (a rule, a quote, a table, a task
 * list, a heading underline, a hand-indented line...) is drawn whole as plain text instead of with
 * characters missing. Nothing in the tree is markup, and a link is https, http
 * or mailto only. Guard: planWriteUp.test.ts ("noteBlocks").
 */
export function noteBlocks(notes: string): MessageBlock[] {
  const { blocks, dropped } = parseMessageMarkdown(notes, { breaks: true });
  if (dropped.length === 0 && !UNDERLINE.test(notes) && !losesIndent(notes))
    return boldHeadings(blocks);
  return [
    {
      type: "paragraph",
      children: notes
        .replace(/\n+$/, "")
        .split("\n")
        .flatMap((line, i): MessageInline[] => [
          ...(i > 0 ? [{ type: "break" } as const] : []),
          { type: "text", text: line },
        ]),
    },
  ];
}
