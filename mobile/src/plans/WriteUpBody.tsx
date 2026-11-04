// A section's text as Markdown under its title (`planWriteUpBlocks`): headings
// come out as bold lines, links open as in an announcement. Reads the cached
// plan, so it needs no network.
import { Text, View } from "react-native";
import {
  noteBlocks,
  planWriteUpBlocks,
  type MessageBlock,
} from "@logjam/shared";

import { MessageInlines } from "../notifications/MessageInlines";
import { listMarker } from "../notifications/messageSpans";
import { makeStyles, spacing } from "../theme";

function MarkdownBlocks({
  blocks,
  role = "body",
}: {
  blocks: MessageBlock[];
  role?: "body" | "paragraph";
}) {
  const styles = useStyles();
  const text = role === "body" ? styles.text : styles.paragraph;
  return (
    <View style={styles.body}>
      {blocks.map((block, i) =>
        block.type === "list" ? (
          <View key={i} style={styles.list}>
            {block.items.map((item, j) => (
              <View key={j} style={styles.item}>
                <Text style={text}>{listMarker(block, j)}</Text>
                <Text style={[text, styles.itemText]} selectable>
                  <MessageInlines inlines={item} />
                </Text>
              </View>
            ))}
          </View>
        ) : block.type === "paragraph" ? (
          <Text key={i} style={text} selectable>
            <MessageInlines inlines={block.children} />
          </Text>
        ) : null,
      )}
    </View>
  );
}

export function WriteUpBody({ title, body }: { title: string; body: string }) {
  return <MarkdownBlocks blocks={planWriteUpBlocks(body, title)} />;
}

/**
 * A place's or a trip's notes, read: the same drawing, every line break kept
 * (`noteBlocks`). The edit field stays plain text.
 */
export function NoteBody({ notes }: { notes: string }) {
  return <MarkdownBlocks blocks={noteBlocks(notes)} role="paragraph" />;
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1) },
  text: { ...textRole.body, color: theme.text },
  paragraph: { ...textRole.paragraph, color: theme.text },
  list: { gap: spacing(0.5) },
  item: { flexDirection: "row", gap: spacing(1) },
  itemText: { flex: 1 },
}));
