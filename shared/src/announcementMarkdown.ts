// A maintainer announcement's body is Markdown, drawn by each client with its
// own components. This turns it into the small tree both clients draw, and is
// the only place the Markdown is read: the send script refuses a message whose
// `dropped` is not empty, so the maintainer finds out before sending.
//
// Nothing here ever yields markup. What the tree cannot hold (raw HTML, an
// image, a table, a code block, a nested list, a link to anything but https,
// http or mailto) becomes plain text and is named in `dropped`. marked's lexer
// only tokenizes; its HTML renderer is never called.
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

  const inlines = (tokens: Token[] = []): MessageInline[] =>
    tokens.flatMap((token): MessageInline[] => {
      const t = token as Tokens.Generic;
      switch (t.type) {
        case "text":
          // A list item's text token nests its own inline tokens.
          return t.tokens ? inlines(t.tokens) : [plain(t.text)];
        case "escape":
          return [plain(t.text)];
        case "strong":
        case "em":
          return [{ type: t.type, children: inlines(t.tokens) }];
        case "codespan":
          return [{ type: "code", text: t.text.replace(/\n/g, " ") }];
        case "br":
          return [{ type: "break" }];
        case "link": {
          const href = String(t.href).trim();
          if (LINK_SCHEMES.test(href)) {
            return [{ type: "link", href, children: inlines(t.tokens) }];
          }
          drop("a link that isn't https, http or mailto");
          return inlines(t.tokens);
        }
        case "image":
          drop("an image");
          return [plain(t.text)];
        case "del":
          drop("strikethrough");
          return inlines(t.tokens);
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
      if (token.type === "checkbox") continue;
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
        case "heading":
          if (t.depth <= 3) {
            return [
              {
                type: "heading",
                level: t.depth as 1 | 2 | 3,
                children: inlines(t.tokens),
              },
            ];
          }
          drop("a heading below level 3");
          return [{ type: "paragraph", children: inlines(t.tokens) }];
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

  const tree = blocks(Lexer.lex(markdown));
  return { blocks: tree, dropped: [...dropped] };
}
