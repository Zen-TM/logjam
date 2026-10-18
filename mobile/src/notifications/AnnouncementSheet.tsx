// A maintainer announcement, opened from its inbox row: the sheet titled with
// the message's own title, who it is from, and its body drawn from the shared
// parser's tree with plain `Text`. Nothing in the tree is markup, and there is
// no WebView (a native dependency would change the fingerprint, ADR 0023).
import { Linking, Text, View } from "react-native";
import {
  ANNOUNCEMENT,
  notificationAnnouncement,
  parseMessageMarkdown,
  type MessageBlock,
  type MessageInline,
} from "@logjam/shared";

import type { TNotification } from "../api/types";
import { inlineText, makeStyles, muted, spacing } from "../theme";
import { BottomSheet, closedSheet } from "../ui";
import { listMarker, messageSpans } from "./messageSpans";

export function AnnouncementSheet({
  notification,
  visible,
  onClose,
}: {
  notification: TNotification | null;
  visible: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const message = notification ? notificationAnnouncement(notification) : null;

  if (!message) return closedSheet;
  const { blocks } = parseMessageMarkdown(message.body);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={message.title}>
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
        <Text
          accessibilityRole="header"
          style={block.level === 1 ? styles.h1 : styles.h2}
        >
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
  }
}

// Nested Text inherits its parent's role, so a run only adds its emphasis.
function Inlines({ inlines }: { inlines: MessageInline[] }) {
  const styles = useStyles();
  return messageSpans(inlines).map((span, i) => {
    const { href } = span;
    return (
      <Text
        key={i}
        style={[
          span.strong && inlineText.strong,
          span.em && styles.em,
          span.code && inlineText.code,
          href !== null && styles.link,
        ]}
        {...(href !== null && {
          accessibilityRole: "link" as const,
          onPress: () => void Linking.openURL(href).catch(console.error),
        })}
      >
        {span.text}
      </Text>
    );
  });
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(2), paddingBottom: spacing(2) },
  from: { ...muted(theme, textRole.detail) },
  h1: { ...textRole.heading, color: theme.text },
  h2: { ...textRole.rowTitle, color: theme.text },
  paragraph: { ...textRole.paragraph, color: theme.text },
  list: { gap: spacing(1) },
  item: { flexDirection: "row", gap: spacing(1) },
  itemText: { flex: 1 },
  em: { fontStyle: "italic" },
  // Text-coloured and underlined, as `TextLink`: words are never an intent
  // colour (shared/DESIGN.md §7).
  link: { textDecorationLine: "underline" },
}));
