import {
  noteBlocks,
  planWriteUpBlocks,
  type MessageBlock,
} from "@logjam/shared";
import { messageInlines } from "../MessageInlines";
import classes from "./WriteUpBody.module.css";

function MarkdownBlocks({
  blocks,
  className = "",
}: {
  blocks: MessageBlock[];
  className?: string;
}) {
  return (
    <div className={`${classes.body} ${className}`}>
      {blocks.map((block, i) => {
        if (block.type === "list") {
          const items = block.items.map((item, j) => (
            <li key={j}>{messageInlines(item)}</li>
          ));
          return block.ordered ? (
            <ol key={i} start={block.start}>
              {items}
            </ol>
          ) : (
            <ul key={i}>{items}</ul>
          );
        }
        return block.type === "paragraph" ? (
          <p key={i}>{messageInlines(block.children)}</p>
        ) : null;
      })}
    </div>
  );
}

/**
 * A section's text as Markdown under its title: headings come out as bold
 * lines (`planWriteUpBlocks`), links open in a new tab, nothing becomes markup.
 */
function WriteUpBody({ title, body }: { title: string; body: string }) {
  return <MarkdownBlocks blocks={planWriteUpBlocks(body, title)} />;
}

/**
 * A place's or a trip's notes, read: the same drawing, every line break kept
 * (`noteBlocks`). The edit field stays plain text.
 */
export function NoteBody({ notes }: { notes: string }) {
  return <MarkdownBlocks blocks={noteBlocks(notes)} className={classes.note} />;
}

export default WriteUpBody;
