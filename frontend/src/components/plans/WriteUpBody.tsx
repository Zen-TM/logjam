import { planWriteUpBlocks } from "@logjam/shared";
import { messageInlines } from "../MessageInlines";
import classes from "./WriteUpBody.module.css";

/**
 * A section's text as Markdown under its title: headings come out as bold
 * lines (`planWriteUpBlocks`), links open in a new tab, nothing becomes markup.
 */
function WriteUpBody({ title, body }: { title: string; body: string }) {
  return (
    <div className={classes.body}>
      {planWriteUpBlocks(body, title).map((block, i) => {
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

export default WriteUpBody;
