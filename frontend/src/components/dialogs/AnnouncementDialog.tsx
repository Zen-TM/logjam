import { useMemo, type ReactNode } from "react";
import {
  ANNOUNCEMENT,
  parseMessageMarkdown,
  type MessageBlock,
  type MessageInline,
} from "@logjam/shared";
import { Dialog } from "../../ui";
import classes from "./AnnouncementDialog.module.css";

function inlines(nodes: MessageInline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={i}>{inlines(node.children)}</strong>;
      case "em":
        return <em key={i}>{inlines(node.children)}</em>;
      case "code":
        return (
          <code key={i} className={classes.code}>
            {node.text}
          </code>
        );
      case "link":
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {inlines(node.children)}
          </a>
        );
      case "break":
        return <br key={i} />;
    }
  });
}

// The dialog's title is the h2, so the message's own headings sit under it.
const HEADING_TAG = { 1: "h3", 2: "h4", 3: "h5" } as const;

function block(node: MessageBlock, i: number): ReactNode {
  switch (node.type) {
    case "heading": {
      const Tag = HEADING_TAG[node.level];
      return (
        <Tag
          key={i}
          className={node.level === 1 ? classes.heading : classes.subheading}
        >
          {inlines(node.children)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={i} className={classes.paragraph}>
          {inlines(node.children)}
        </p>
      );
    case "list": {
      const items = node.items.map((item, j) => (
        <li key={j}>{inlines(item)}</li>
      ));
      return node.ordered ? (
        <ol key={i} start={node.start} className={classes.list}>
          {items}
        </ol>
      ) : (
        <ul key={i} className={classes.list}>
          {items}
        </ul>
      );
    }
  }
}

/**
 * A maintainer announcement, opened from its inbox row. The body is drawn
 * from the shared parser's tree as plain React elements, so nothing the
 * maintainer wrote can become markup (AnnouncementDialog.test.tsx).
 */
function AnnouncementDialog({
  message,
  onClose,
}: {
  message: { title: string; body: string } | null;
  onClose: () => void;
}) {
  const blocks = useMemo(
    () => (message ? parseMessageMarkdown(message.body).blocks : []),
    [message],
  );
  return (
    <Dialog
      open={message != null}
      title={message?.title}
      onClose={onClose}
      size="large"
    >
      <p className={classes.from}>{ANNOUNCEMENT.from}</p>
      <div className={classes.message}>{blocks.map(block)}</div>
    </Dialog>
  );
}

export default AnnouncementDialog;
