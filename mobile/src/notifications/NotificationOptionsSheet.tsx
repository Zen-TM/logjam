// The verb list for ONE notification — the sheet the inbox's ⋯ opens
// (DESIGN.md §7: per-item actions live in an overflow sheet, titled with the
// item, so rows stay clean and a mis-tap can't destroy anything).
//
// Three verbs, and no more. "Open" is the row's own tap, repeated here because
// a menu that cannot do the obvious thing reads as a menu that is missing
// something; it is absent when the notification is about nothing openable (a
// finished topo job, a friend request answered in the row itself). Read/unread
// is ONE row whose direction follows the notification's current state. Delete
// is last and warning-hued, as everywhere else.
//
// Accept / Turn down are deliberately NOT here: they already sit in the row, and
// a question with two answers in two places is how one of them goes stale
// (`notificationActions.ts` stays the single source of those).
//
// PRIVACY: the sheet's title is the row's own label, which may carry a canyon
// name or a filename — user text, rendered and never logged (DESIGN.md §11).
import { Alert, StyleSheet, View } from "react-native";

import type { TNotification } from "../api/types";
import { theme, spacing } from "../theme";
import { BottomSheet, Row } from "../ui";
import { notificationCanyonId, notificationLabel } from "../screens/notificationLabel";

export function NotificationOptionsSheet({
  notification,
  visible,
  onClose,
  onOpen,
  onSetRead,
  onDelete,
}: {
  notification: TNotification | null;
  visible: boolean;
  onClose: () => void;
  /** Follow the notification through to the thing it is about. */
  onOpen: (notification: TNotification) => void;
  onSetRead: (notification: TNotification, read: boolean) => void;
  onDelete: (notification: TNotification) => void;
}) {
  if (!notification) return null;

  const label = notificationLabel(notification);
  const openable = notificationCanyonId(notification) !== null;

  const act = (run: () => void) => {
    onClose();
    run();
  };

  const confirmDelete = () =>
    act(() =>
      // One notification, so the sentence is short — but it is still a dialog,
      // because a delete is not undoable and there is no trash to fish it out
      // of (DESIGN.md §7).
      Alert.alert("Delete this notification?", "It goes from every device on your account. This can't be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => onDelete(notification),
        },
      ]),
    );

  return (
    <BottomSheet visible={visible} onClose={onClose} title={label.text}>
      <View style={styles.body}>
        {openable ? (
          <Row
            icon="external-link"
            title="Open"
            onPress={() => act(() => onOpen(notification))}
          />
        ) : null}
        <Row
          icon={notification.read ? "eye-off" : "eye"}
          title={notification.read ? "Mark as unread" : "Mark as read"}
          onPress={() => act(() => onSetRead(notification, !notification.read))}
        />
        <Row
          icon="trash-2"
          hue={theme.warning}
          title="Delete notification"
          onPress={confirmDelete}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
});
