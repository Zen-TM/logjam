import { Pressable, Text } from "react-native";

import { makeStyles, spacing, useTheme } from "../theme";
import { SEARCH_SIZE } from "../map/mapChrome";
import { Icon, type Glyph } from "./Icon";
import { IconButton } from "./IconButton";

/**
 * A mode the map is in, as a pill in the top row beside the search
 * button (a plan on the map, navigating to a place, a filter hiding pins). It
 * is the search button's height and colour, so it reads as part of that row,
 * and the parent insets it so an expanded search bar covers it
 * (`mapBannerInsets`). Whatever does not fit is cut to one line; pressing the
 * pill opens what it is about or shows `fullText` (shared/DESIGN.md §15).
 * Status that is not a mode with a way out stays a `Notice`.
 */
export function MapBanner({
  icon,
  label,
  fullText,
  dismissLabel,
  onDismiss,
  onPress,
}: {
  icon?: Glyph;
  /** One line; ellipsised when it does not fit. */
  label: string;
  /** What a screen reader says: the whole of it. Defaults to `label`. */
  fullText?: string;
  /** Names the X; with `onDismiss`, the X is the last thing in the pill. */
  dismissLabel?: string;
  onDismiss?: () => void;
  /** Opens what the banner is about, or shows its full text. */
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fullText ?? label}
      onPress={onPress}
      style={[styles.pill, onDismiss ? styles.withX : null]}
    >
      {icon ? <Icon idea={icon} size={16} color={theme.accent} /> : null}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {onDismiss ? (
        <IconButton
          icon="close"
          size={16}
          accessibilityLabel={dismissLabel ?? "Dismiss"}
          onPress={onDismiss}
        />
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  pill: {
    height: SEARCH_SIZE,
    borderRadius: SEARCH_SIZE / 2,
    backgroundColor: theme.card,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingHorizontal: spacing(2),
    overflow: "hidden",
  },
  // The 40dp X centred in the end cap.
  withX: { paddingRight: (SEARCH_SIZE - 40) / 2 },
  label: { ...textRole.detail, color: theme.text, flex: 1 },
}));
