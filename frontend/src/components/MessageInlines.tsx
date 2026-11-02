import type { ReactNode } from "react";
import type { MessageInline } from "@logjam/shared";

// A message's inline tree as plain React elements, so nothing the author wrote
// can become markup. Shared by announcements and a plan's write-up.
export function messageInlines(nodes: MessageInline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={i}>{messageInlines(node.children)}</strong>;
      case "em":
        return <em key={i}>{messageInlines(node.children)}</em>;
      case "code":
        return <code key={i}>{node.text}</code>;
      case "link":
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {messageInlines(node.children)}
          </a>
        );
      case "break":
        return <br key={i} />;
      default:
        return node satisfies never;
    }
  });
}
