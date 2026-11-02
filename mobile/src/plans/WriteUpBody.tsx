// A section's text as Markdown under its title (`planWriteUpBlocks`): headings
// come out as bold lines, links open as in an announcement. Reads the cached
// plan, so it needs no network.
import { Text, View } from "react-native";
import { planWriteUpBlocks } from "@logjam/shared";

import { MessageInlines } from "../notifications/MessageInlines";
import { listMarker } from "../notifications/messageSpans";
import { makeStyles, spacing } from "../theme";

export function WriteUpBody({ title, body }: { title: string; body: string }) {
  const styles = useStyles();
  return (
    <View style={styles.body}>
      {planWriteUpBlocks(body, title).map((block, i) =>
        block.type === "list" ? (
          <View key={i} style={styles.list}>
            {block.items.map((item, j) => (
              <View key={j} style={styles.item}>
                <Text style={styles.text}>{listMarker(block, j)}</Text>
                <Text style={[styles.text, styles.itemText]} selectable>
                  <MessageInlines inlines={item} />
                </Text>
              </View>
            ))}
          </View>
        ) : block.type === "paragraph" ? (
          <Text key={i} style={styles.text} selectable>
            <MessageInlines inlines={block.children} />
          </Text>
        ) : null,
      )}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1) },
  text: { ...textRole.body, color: theme.text },
  list: { gap: spacing(0.5) },
  item: { flexDirection: "row", gap: spacing(1) },
  itemText: { flex: 1 },
}));
