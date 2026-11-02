import { useSyncExternalStore } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { radius, scrim, spacing, makeStyles } from "./theme";
import { answerConfirm, Button, pendingConfirm, subscribeConfirm } from "./ui";

/**
 * Draws what `confirm()` asks, in the current scheme: the kit's dialog, as
 * Logjam Web's `ConfirmDialog` is. Cancel on the left, the verb on the right;
 * a destructive verb wears the warning fill and a glyph, a filled one the
 * accent. Mounted once, at the shell. Its own Modal opens after any sheet's, so
 * it stands over the form it acts for (mobile/DESIGN.md §4).
 */
export function ConfirmHost() {
  const pending = useSyncExternalStore(subscribeConfirm, pendingConfirm);
  const styles = useStyles();
  const cancel = () => answerConfirm(false);
  const copy = pending?.copy;
  return (
    <Modal
      visible={pending != null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={cancel}
    >
      <Pressable
        style={styles.backdrop}
        onPress={cancel}
        accessibilityLabel="Cancel"
        accessibilityRole="button"
      >
        {pending && copy ? (
          // A press on the card is its own: it never reaches the backdrop.
          <Pressable
            style={styles.card}
            accessibilityViewIsModal
            accessible={false}
          >
            <Text style={styles.title} accessibilityRole="header">
              {copy.confirmTitle}
            </Text>
            <ScrollView style={styles.bodyScroll}>
              <Text style={styles.body}>{copy.confirmBody}</Text>
            </ScrollView>
            <View style={styles.actions}>
              <Button
                label={pending.cancelLabel}
                variant="ghost"
                onPress={cancel}
              />
              <Button
                label={copy.confirmLabel}
                variant={
                  copy.tone === "destructive" ? "destructive" : "filledAccent"
                }
                icon={
                  copy.tone === "destructive"
                    ? (copy.icon ?? "delete")
                    : undefined
                }
                onPress={() => answerConfirm(true)}
              />
            </View>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing(3),
    backgroundColor: scrim.light,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    maxHeight: "90%",
    gap: spacing(1),
    padding: spacing(2),
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.page,
  },
  title: { ...textRole.heading, color: theme.text },
  bodyScroll: { flexShrink: 1 },
  body: { ...textRole.body, color: theme.text },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing(1),
    paddingTop: spacing(1),
  },
}));
