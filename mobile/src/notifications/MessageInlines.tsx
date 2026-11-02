// A message's inline tree as nested `Text`, shared by announcements and a
// plan's write-up. Nested Text inherits its parent's role, so a run only adds
// its emphasis.
import { Linking, Platform, Text } from "react-native";
import type { MessageInline } from "@logjam/shared";

import { inlineText, makeStyles } from "../theme";
import { messageSpans } from "./messageSpans";

export function MessageInlines({ inlines }: { inlines: MessageInline[] }) {
  const styles = useStyles();
  return messageSpans(inlines).map((span, i) => {
    const { href } = span;
    return (
      <Text
        key={i}
        style={[
          span.strong && inlineText.strong,
          span.em && styles.em,
          span.code && Platform.select(inlineText.code),
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

const useStyles = makeStyles(() => ({
  em: { fontStyle: "italic" },
  // Text-coloured and underlined, as `TextLink`: words are never an intent
  // colour (shared/DESIGN.md §7).
  link: { textDecorationLine: "underline" },
}));
