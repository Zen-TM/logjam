// A maintainer announcement's body is Markdown, drawn by each client with its
// own components. This turns it into the small tree both clients draw. The
// send script refuses a message whose `dropped` is not empty, so the
// maintainer finds out before sending (Guard: api/src/scripts/announce.unit.test.ts).
//
// Nothing here yields markup. What the tree cannot hold (raw HTML, an image, a
// table, a code block, a nested list, a link to anything but https, http or
// mailto) becomes plain text and is named in `dropped`; marked's lexer only
// tokenizes and its HTML renderer is never called. Guard:
// announcementMarkdown.test.ts ("keeps raw HTML…", "unlinks…").
//
// Heading levels are relative: the shallowest heading in a message is level
// 1, so a body that starts at `##` reads the same as one that starts at `#`.
import { Lexer, type Token, type Tokens } from "marked";

export type MessageInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: MessageInline[] }
  | { type: "em"; children: MessageInline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: MessageInline[] }
  | { type: "break" };

export type MessageBlock =
  | { type: "heading"; level: 1 | 2 | 3; children: MessageInline[] }
  | { type: "paragraph"; children: MessageInline[] }
  | {
      type: "list";
      ordered: boolean;
      /** The first item's number; 1 for a bullet list. */
      start: number;
      items: MessageInline[][];
    };

export type ParsedMessage = {
  blocks: MessageBlock[];
  /** What the source used that the tree cannot hold, each named once. */
  dropped: string[];
};

const LINK_SCHEMES = /^(https?|mailto):/i;
// marked decodes numeric references in text, but no references in a link
// destination, where an undecoded one would show literally ("R&amp;D") or
// bend the link (`&#38;` turns the rest into a fragment).
const NAMED_ENTITY = /&[a-z][a-z0-9]*;/i;
const ANY_ENTITY = /&(#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

export function parseMessageMarkdown(markdown: string): ParsedMessage {
  const dropped = new Set<string>();
  const drop = (what: string) => dropped.add(what);

  // Plain text that keeps its line breaks: what an unsupported block becomes.
  const lines = (text: string): MessageInline[] =>
    text
      .replace(/\n+$/, "")
      .split("\n")
      .flatMap((line, i) =>
        i === 0 ? [plain(line)] : [{ type: "break" }, plain(line)],
      );

  // A soft line break inside a paragraph is a space, as Markdown renders it.
  const plain = (text: string): MessageInline => ({
    type: "text",
    text: text.replace(/\n/g, " "),
  });

  const inlines = (tokens: Token[] = [], inLink = false): MessageInline[] =>
    tokens.flatMap((token): MessageInline[] => {
      const t = token as Tokens.Generic;
      switch (t.type) {
        case "text":
          // A list item's text token nests its own inline tokens.
          if (t.tokens) return inlines(t.tokens, inLink);
          if (NAMED_ENTITY.test(t.text)) drop("an HTML entity");
          return [plain(t.text)];
        case "escape":
          return [plain(t.text)];
        case "strong":
        case "em":
          return [{ type: t.type, children: inlines(t.tokens, inLink) }];
        case "codespan":
          return [{ type: "code", text: t.text.replace(/\n/g, " ") }];
        case "br":
          return [{ type: "break" }];
        case "link": {
          const href = String(t.href).trim();
          if (inLink) {
            // An autolink inside a link's text: a link can't hold a link.
            drop("a link inside a link");
            return inlines(t.tokens, inLink);
          }
          if (ANY_ENTITY.test(href)) drop("an HTML entity");
          if (LINK_SCHEMES.test(href)) {
            return [{ type: "link", href, children: inlines(t.tokens, true) }];
          }
          drop("a link that isn't https, http or mailto");
          return inlines(t.tokens);
        }
        case "image":
          drop("an image");
          return [plain(t.text)];
        case "del":
          drop("strikethrough");
          return inlines(t.tokens, inLink);
        case "html":
          drop("raw HTML");
          return [plain(t.raw)];
        default:
          drop(`Markdown "${t.type}"`);
          return [plain(t.raw)];
      }
    });

  const listItem = (item: Tokens.ListItem): MessageInline[] => {
    if (item.task) drop("a task list");
    const out: MessageInline[] = [];
    for (const token of item.tokens) {
      let content: MessageInline[];
      // A blank line inside an item; the break between its parts is enough.
      if (token.type === "checkbox" || token.type === "space") continue;
      if (token.type === "text" || token.type === "paragraph") {
        content = inlines((token as Tokens.Generic).tokens);
      } else if (token.type === "list") {
        // One level deep: a nested list's items become lines of this one.
        drop("a nested list");
        content = (token as Tokens.List).items.flatMap((nested, i) => [
          ...(i > 0 ? [{ type: "break" } as const] : []),
          ...listItem(nested),
        ]);
      } else {
        drop(`Markdown "${token.type}" in a list`);
        content = lines(token.raw);
      }
      if (out.length > 0 && content.length > 0) out.push({ type: "break" });
      out.push(...content);
    }
    return out;
  };

  const blocks = (tokens: Token[]): MessageBlock[] =>
    tokens.flatMap((token): MessageBlock[] => {
      const t = token as Tokens.Generic;
      switch (t.type) {
        case "space":
        // A reference definition: its links already resolved into the text.
        case "def":
          return [];
        case "heading": {
          const level = t.depth - topDepth + 1;
          if (level <= 3) {
            return [
              {
                type: "heading",
                level: level as 1 | 2 | 3,
                children: inlines(t.tokens),
              },
            ];
          }
          drop("a heading more than two levels below the top one");
          return [{ type: "paragraph", children: inlines(t.tokens) }];
        }
        case "paragraph":
        case "text":
          return [{ type: "paragraph", children: inlines(t.tokens) }];
        case "list": {
          const list = t as Tokens.List;
          return [
            {
              type: "list",
              ordered: list.ordered,
              start: list.ordered && list.start !== "" ? list.start : 1,
              items: list.items.map(listItem),
            },
          ];
        }
        case "blockquote":
          drop("a blockquote");
          return blocks(t.tokens ?? []);
        case "hr":
          drop("a horizontal rule");
          return [];
        case "code":
          drop("a code block");
          return [{ type: "paragraph", children: lines(t.text) }];
        case "html":
          drop("raw HTML");
          return [{ type: "paragraph", children: lines(t.raw) }];
        case "table":
          drop("a table");
          return [{ type: "paragraph", children: lines(t.raw) }];
        default:
          drop(`Markdown "${t.type}"`);
          return [{ type: "paragraph", children: lines(t.raw) }];
      }
    });

  const tokens = Lexer.lex(markdown);
  // Over every heading blocks() draws, a blockquote's included.
  const depths = (ts: Token[]): number[] =>
    ts.flatMap((t) =>
      t.type === "heading"
        ? [(t as Tokens.Heading).depth]
        : t.type === "blockquote"
          ? depths((t as Tokens.Blockquote).tokens)
          : [],
    );
  const topDepth = Math.min(...depths(tokens));
  const tree = blocks(tokens);
  return { blocks: tree, dropped: [...dropped] };
}
