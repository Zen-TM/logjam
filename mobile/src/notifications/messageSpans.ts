// A maintainer announcement's inline tree, flattened into the runs of styled
// text React Native draws as nested `Text`. Its own module, free of React
// Native imports, so it can be unit-tested (same split as `tapTarget.ts`).
import type { MessageBlock, MessageInline } from "@logjam/shared";

/** One run of plain text and the emphasis it sits inside. */
export type MessageSpan = {
  text: string;
  strong: boolean;
  em: boolean;
  code: boolean;
  /**
   * Already https, http or mailto: the shared parser drops anything else.
   * Guard: shared/src/announcementMarkdown.test.ts ("unlinks %s…").
   */
  href: string | null;
};

type Marks = Omit<MessageSpan, "text">;

const PLAIN: Marks = { strong: false, em: false, code: false, href: null };

/**
 * Emphasis nests (a link inside bold stays bold), and a hard line break is a
 * newline in the run, which RN's Text draws as one.
 */
export function messageSpans(
  inlines: MessageInline[],
  marks: Marks = PLAIN,
): MessageSpan[] {
  return inlines.flatMap((inline): MessageSpan[] => {
    switch (inline.type) {
      case "text":
        return [{ ...marks, text: inline.text }];
      case "break":
        return [{ ...marks, text: "\n" }];
      case "code":
        return [{ ...marks, code: true, text: inline.text }];
      case "strong":
        return messageSpans(inline.children, { ...marks, strong: true });
      case "em":
        return messageSpans(inline.children, { ...marks, em: true });
      case "link":
        return messageSpans(inline.children, { ...marks, href: inline.href });
    }
  });
}

/** The marker drawn before a list's item `index`: "3." or a bullet. */
export function listMarker(
  list: Extract<MessageBlock, { type: "list" }>,
  index: number,
): string {
  return list.ordered ? `${list.start + index}.` : "•";
}
