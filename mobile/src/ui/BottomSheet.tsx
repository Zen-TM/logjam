import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";

// Slide-up modal sheet with a drag handle + title, capped at 80% height and
// scrolling within. The sheet body is a Pressable that absorbs taps, so taps
// on empty sheet space (or that overshoot a small control) can't reach the
// backdrop and dismiss it — only the handle/backdrop close it. Fixes the
// earlier "tap near a row dismisses the sheet" trap.
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={styles.handleHit}
          >
            <View style={styles.handle} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    backgroundColor: theme.primary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(3),
    maxHeight: "80%",
  },
  handleHit: { alignItems: "center", paddingVertical: spacing(1.5) },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.bonus2,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: theme.textPrimary,
    marginBottom: spacing(0.5),
  },
  scrollContent: { paddingBottom: spacing(2) },
});
