import { Pressable, Text, View } from "react-native";

import {
  fontSize,
  radius,
  spacing,
  makeStyles,
  useTheme,
  withAlpha,
} from "../theme";
import { Icon } from "./Icon";

type ErrorBannerProps = {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
};

// Inline error surface for form/submission failures — one banner per form, the
// same component as Logjam Web's `ErrorBanner` (never raw err.message; callers
// pass output of messageFromError). The warning is the edge and the glyph; the
// words are `text`.
export function ErrorBanner({ message, onRetry, onDismiss }: ErrorBannerProps) {
  const theme = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Icon idea="warning" size={16} color={theme.warning} />
      <View style={styles.content}>
        <Text style={styles.message}>{message}</Text>
        {onRetry || onDismiss ? (
          <View style={styles.actions}>
            {onRetry ? (
              <Pressable
                onPress={onRetry}
                accessibilityRole="button"
                hitSlop={16}
              >
                <Text style={styles.action}>Try again</Text>
              </Pressable>
            ) : null}
            {onDismiss ? (
              <Pressable
                onPress={onDismiss}
                accessibilityRole="button"
                hitSlop={16}
              >
                <Text style={styles.action}>Dismiss</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing(1),
    // Warning hue at ~12%, so it tracks the active scheme.
    backgroundColor: withAlpha(theme.warning, 0.12),
    borderWidth: 1,
    borderColor: theme.warning,
    borderRadius: radius.md,
    padding: spacing(1.5),
  },
  content: { flex: 1, gap: spacing(1) },
  message: { color: theme.text, fontSize: fontSize.sm },
  actions: { flexDirection: "row", gap: spacing(2) },
  action: {
    ...textRole.control,
    color: theme.text,
    textDecorationLine: "underline",
  },
}));
