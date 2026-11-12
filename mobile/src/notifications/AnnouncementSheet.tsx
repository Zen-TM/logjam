// A maintainer announcement, opened from its inbox row: the sheet titled with
// the message's own title, who it is from, and its body drawn from the shared
// parser's tree with plain `Text`. Nothing in the tree is markup, and there is
// no WebView (a native dependency would change the fingerprint, ADR 0023).
import { Text, View } from "react-native";
import {
  ANNOUNCEMENT,
  notificationAnnouncement,
  parseMessageMarkdown,
  type MessageBlock,
} from "@logjam/shared";

import type { TNotification } from "../api/types";
import { makeStyles, muted, spacing } from "../theme";
import { BottomSheet } from "../ui";
import { MessageInlines as Inlines } from "./MessageInlines";
import { listMarker } from "./messageSpans";

export function AnnouncementSheet({
  notification,
  visible,
  onClose,
  onClosed,
}: {
  notification: TNotification | null;
  visible: boolean;
  onClose: () => void;
  onClosed?: () => void;
}) {
  const styles = useStyles();
  const message = notification ? notificationAnnouncement(notification) : null;

  // Not `closedSheet`: the owner clears the subject as it closes the sheet,
  // and `onClosed` has to outlive that render to fire at the end of the slide.
  if (!message) {
    return (
      <BottomSheet
        visible={false}
        onClose={onClose}
        onClosed={onClosed}
        title=""
      >
        {null}
      </BottomSheet>
    );
  }
  const { blocks } = parseMessageMarkdown(message.body);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      title={message.title}
    >
      <View style={styles.body}>
        <Text style={styles.from}>{ANNOUNCEMENT.from}</Text>
        {blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </View>
    </BottomSheet>
  );
}

function Block({ block }: { block: MessageBlock }) {
  const styles = useStyles();
  switch (block.type) {
    case "heading":
      return (
        <Text accessibilityRole="header" style={styles.heading}>
          <Inlines inlines={block.children} />
        </Text>
      );
    case "paragraph":
      return (
        <Text style={styles.paragraph}>
          <Inlines inlines={block.children} />
        </Text>
      );
    case "list":
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text style={styles.paragraph}>{listMarker(block, i)}</Text>
              <Text style={[styles.paragraph, styles.itemText]}>
                <Inlines inlines={item} />
              </Text>
            </View>
          ))}
        </View>
      );
    default:
      return block satisfies never;
  }
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(2), paddingBottom: spacing(2) },
  from: { ...muted(theme, textRole.detail) },
  // One role for every level, the nearest below the sheet title's `heading`
  // (shared/DESIGN.md §2), as on Logjam Web.
  heading: { ...textRole.rowTitle, color: theme.text },
  paragraph: { ...textRole.paragraph, color: theme.text },
  list: { gap: spacing(1) },
  item: { flexDirection: "row", gap: spacing(1) },
  itemText: { flex: 1 },
}));
