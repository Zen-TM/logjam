import { Fragment, type ReactNode } from "react";
import type { RichPart } from "@logjam/shared";

/**
 * A `rich` sentence with each tag drawn as an element, inside a `<Text>`:
 * `<Rich parts={rich`Read the <a>${name}</a>.`} tags={{ a: (text) => <Text onPress={…}>{text}</Text> }} />`.
 * A tag the message uses but `tags` does not name stays plain text, so a
 * catalogue entry that renames a tag loses its styling, not its words.
 */
export function Rich({
  parts,
  tags,
}: {
  parts: readonly RichPart[];
  tags: Record<string, (text: string) => ReactNode>;
}) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {typeof part === "string"
            ? part
            : (tags[part.tag]?.(part.text) ?? part.text)}
        </Fragment>
      ))}
    </>
  );
}
