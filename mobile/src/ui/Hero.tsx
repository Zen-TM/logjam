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
 *
 * `compact` is the pinned form for a long list: ONE row (back arrow, title,
 * `actions`) and nothing else, so the headline metric, meter, chips and search
 * scroll with the list instead of eating the screen. `children` then takes the
 * row's slot while it is set (a multi-select's bar), at the same height so the
 * list does not jump. Guard: `heroCompact.test.ts`.
 */
export function Hero({
  eyebrow,
  title,
  titleNumberOfLines = 2,
  wrapValue = false,
  value,
  secondaryValue,
  valueSuffix,
  actions,
  compact = false,
  onBack,
  backLabel,
  children,
}: {
  compact?: boolean;
  eyebrow?: string;
  title: string;
  titleNumberOfLines?: number;
  /** Lets the value line wrap instead of ending in an ellipsis, for a value
   *  that is a sentence (the save screen's estimates) and not a figure. */
  wrapValue?: boolean;
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
  if (compact)
    return (
      <CompactHero
        title={title}
        titleNumberOfLines={titleNumberOfLines}
        actions={actions}
        onBack={onBack}
        backLabel={backLabel}
      >
        {children}
      </CompactHero>
    );
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
        <Text
          accessibilityRole="header"
          style={styles.title}
          numberOfLines={titleNumberOfLines}
        >
          {title}
        </Text>
        {actions}
      </View>
      {value ? (
        <Text style={styles.value} numberOfLines={wrapValue ? undefined : 1}>
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

function CompactHero({
  title,
  titleNumberOfLines,
  actions,
  onBack,
  backLabel,
  children,
}: {
  title: string;
  titleNumberOfLines: number;
  actions?: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.compact, { paddingTop: insets.top }]}>
      <View style={styles.compactRow}>
        {children != null ? (
          <View style={styles.compactSlot}>{children}</View>
        ) : (
          <>
            {onBack ? (
              <IconButton
                icon="back"
                accessibilityLabel={`Back to ${backLabel}`}
                color={theme.text}
                onPress={onBack}
              />
            ) : null}
            <Text style={styles.title} numberOfLines={titleNumberOfLines}>
              {title}
            </Text>
            {actions}
          </>
        )}
      </View>
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
  compact: {
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
    paddingHorizontal: spacing(2),
  },
  compactRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
  },
  compactSlot: { flex: 1, marginHorizontal: -spacing(1) },
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
