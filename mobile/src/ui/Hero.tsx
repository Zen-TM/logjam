import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { spacing, makeStyles, useTheme, muted } from "../theme";
import { IconButton } from "./IconButton";

/**
 * Screen-opening hero — replaces the native stack header on screens that lead
 * with a headline metric or state (`headerShown: false` on the route).
 *
 * Anatomy, top to bottom: back row (pushed screens: arrow + the destination's
 * name) · eyebrow (uppercase kicker) · title + optional
 * trailing `actions` node on the same baseline · optional `value`/`valueSuffix`
 * display metric · optional `children` (meter, readiness pill, chips).
 *
 * It carries its own top safe-area inset and a hairline bottom edge, so the
 * screen body below it is plain padded content.
 */
export function Hero({
  eyebrow,
  title,
  titleNumberOfLines = 1,
  value,
  secondaryValue,
  valueSuffix,
  actions,
  onBack,
  backLabel,
  children,
}: {
  eyebrow?: string;
  title: string;
  titleNumberOfLines?: number;
  value?: string;
  /**
   * A second stat of EQUAL weight beside `value`, middot-separated. The
   * download screen's estimated size and estimated time are peers — the time
   * is not supporting detail of the size, and rendering it as `valueSuffix`
   * (a smaller, muted font) said that it was.
   */
  secondaryValue?: string;
  valueSuffix?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
} & (
  | { onBack?: undefined; backLabel?: undefined }
  | {
      onBack: () => void;
      /**
       * Where back goes, by name (`backLabelOf`). Text beside a back arrow
       * names its destination, so the eyebrow never shares that row.
       */
      backLabel: string;
    }
)) {
  const theme = useTheme();
  const styles = useStyles();

  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.hero, { paddingTop: insets.top + spacing(1.5) }]}>
      {onBack ? (
        <View style={styles.backRow}>
          <IconButton
            icon="back"
            accessibilityLabel={`Back to ${backLabel}`}
            color={theme.text}
            onPress={onBack}
          />
          <Text style={styles.eyebrow} numberOfLines={1}>
            {backLabel}
          </Text>
        </View>
      ) : null}
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={titleNumberOfLines}>
          {title}
        </Text>
        {actions}
      </View>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {secondaryValue ? `${value} · ${secondaryValue}` : value}
          {valueSuffix ? (
            <Text style={styles.valueSuffix}> {valueSuffix}</Text>
          ) : null}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  hero: {
    // No fill: it sits on the page and a hairline separates it from the list,
    // as Logjam Web's hero does. A fill, a step lighter than the card,
    // fails AA under its own text in Sandstone and Ironbark.
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(2),
    gap: spacing(1),
  },
  eyebrow: {
    ...muted(theme, textRole.section),
    letterSpacing: 1,
  },
  // The back button sits beside the name of where it goes and hangs into the horizontal
  // padding, so the title still starts on the screen's text margin.
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: -spacing(1),
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing(1.5) },
  title: {
    flex: 1,
    ...textRole.title,
    color: theme.text,
  },
  // The metric is supporting information, not the point of the screen: one
  // step above body text, not a billboard.
  value: {
    ...textRole.heading,
    color: theme.text,
  },
  valueSuffix: { ...muted(theme, textRole.detail) },
}));
