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
  return kept.map((block) =>
    block.type === "heading"
      ? {
          type: "paragraph",
          children: [{ type: "strong", children: block.children }],
        }
      : block,
  );
}
