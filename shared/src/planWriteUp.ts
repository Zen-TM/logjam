// A plan section's text is Markdown under the section's own title, so a
// heading in it must never look like a second title. The tree is the
// announcements' (`parseMessageMarkdown`): paragraphs, bold, italic, code,
// links (https, http, mailto) and lists. Images, HTML, tables and code blocks
// come out as plain text. Guard: planWriteUp.test.ts.
import { getDefaults, Lexer } from "marked";
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

const typed = (source: string): MessageBlock => ({
  type: "paragraph",
  children: source
    .replace(/\n+$/, "")
    .split("\n")
    .flatMap((line, i): MessageInline[] => [
      ...(i > 0 ? [{ type: "break" } as const] : []),
      { type: "text", text: line },
    ]),
});

/** Whether drawing `source` would lose characters, so it is shown as typed. */
function losesText(source: string, dropped: string[]): boolean {
  return dropped.length > 0 || UNDERLINE.test(source) || losesIndent(source);
}

/**
 * The blocks to draw for a place's or a trip's free-text notes: the same
 * Markdown subset, every line break kept. A note is shown as typed, so each
 * top-level block that uses anything the subset cannot draw (a rule, a quote,
 * a table, a task list, a heading underline, a hand-indented line...) is drawn
 * as plain text instead of with characters missing, and the rest of the note
 * still renders. Blank lines between blocks are paragraph gaps, as in drawn
 * Markdown. A note with a link reference definition (`[g]: https://...`) is
 * all-or-nothing instead: a definition is read from anywhere in the note, so
 * a block parsed alone would lose its links. Nothing in the tree is markup,
 * and a link is https, http or mailto only. Guard: planWriteUp.test.ts
 * ("noteBlocks").
 */
export function noteBlocks(notes: string): MessageBlock[] {
  const options = { ...getDefaults(), breaks: true };
  const tokens = Lexer.lex(notes, options);
  if (tokens.some((token) => token.type === "def")) {
    const { blocks, dropped } = parseMessageMarkdown(notes, { breaks: true });
    return losesText(notes, dropped) ? [typed(notes)] : boldHeadings(blocks);
  }
  return tokens
    .filter((token) => token.raw.trim())
    .flatMap((token): MessageBlock[] => {
      const { blocks, dropped } = parseMessageMarkdown(token.raw, {
        breaks: true,
      });
      return losesText(token.raw, dropped)
        ? [typed(token.raw)]
        : boldHeadings(blocks);
    });
}
