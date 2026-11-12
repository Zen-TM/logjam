import { useMemo, type ReactNode } from "react";
import {
  ANNOUNCEMENT,
  parseMessageMarkdown,
  type MessageBlock,
} from "@logjam/shared";
import { Button, Dialog } from "../../ui";
import { messageInlines } from "../MessageInlines";
import classes from "./AnnouncementDialog.module.css";

// The dialog's title is the h2, so the message's own headings sit under it;
// the parser makes the shallowest level 1, so none is skipped.
const HEADING_TAG = { 1: "h3", 2: "h4", 3: "h5" } as const;

function block(node: MessageBlock, i: number): ReactNode {
  switch (node.type) {
    case "heading": {
      const Tag = HEADING_TAG[node.level];
      return (
        <Tag key={i} className={classes.heading}>
          {messageInlines(node.children)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={i} className={classes.paragraph}>
          {messageInlines(node.children)}
        </p>
      );
    case "list": {
      const items = node.items.map((item, j) => (
        <li key={j}>{messageInlines(item)}</li>
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
    default:
      return node satisfies never;
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
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <p className={classes.from}>{ANNOUNCEMENT.from}</p>
      <div className={classes.message}>{blocks.map(block)}</div>
    </Dialog>
  );
}

export default AnnouncementDialog;
