import { ScrollView, Text, View, useWindowDimensions } from "react-native";

import {
  makeStyles,
  muted,
  radius,
  spacing,
  useTheme,
  wash,
  withAlpha,
} from "../theme";
import { Icon, type Glyph } from "./Icon";

export type ForecastCard = {
  key: string;
  /** "Now", "3 pm", "Today", "Mon 20". */
  label: string;
  /** The card the eye starts on. */
  current?: boolean;
  /** Null where the card is a rain total (a past day). */
  glyph: Glyph | null;
  /** What the glyph says, spoken ("Rain"). */
  glyphLabel: string;
  temperature: string | null;
  rain: string;
  /** 0 to 1; zero leaves the bar empty rather than a floor-high sliver. */
  rainLevel: number;
  chance: string | null;
  wind: string | null;
  /** A figure not of its row's kind ("Model" in a gauge's row): said under
   *  it, and its bar drawn muted. */
  note: string | null;
  /** Everything on the card, in words. */
  spoken: string;
};

// A card and the gap after it: four and a half fit a phone's sheet, so the next
// one peeks and says there is more. A larger system font widens the cards
// rather than wrapping "10 km/h": fewer fit and the row scrolls further.
const CARD_WIDTH = spacing(6) + spacing(2);
const forecastCardWidth = (fontScale: number): number =>
  Math.round(CARD_WIDTH * Math.max(1, fontScale));
const GAP = spacing(0.5);

// A titled row of cards that scrolls sideways: one per hour, day or past day,
// each a label, condition glyph, temperature, rain bar and amount, chance and
// wind. Read-only, so no card fill: that colour means "press me". Same name and
// props as Logjam Web's (shared/DESIGN.md §14), minus its ‹ › buttons, which a
// finger has no use for.
//
// A horizontal ScrollView takes only horizontal drags, so a vertical one still
// goes to the sheet's pull-down (ui/BottomSheet.tsx).
export function ForecastRail({
  title,
  summary,
  cards,
}: {
  title: string;
  /** A total for the row ("34 mm"), at its right. */
  summary?: string | null;
  cards: readonly ForecastCard[];
}) {
  const theme = useTheme();
  const styles = useStyles();
  const width = forecastCardWidth(useWindowDimensions().fontScale);
  return (
    <View style={styles.rail}>
      <View style={styles.heading} accessible accessibilityRole="header">
        <Text style={styles.title}>{title}</Text>
        {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      </View>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={width + GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={styles.track}
        accessibilityLabel={title}
      >
        {cards.map((card) => (
          <View
            key={card.key}
            style={[styles.card, { width }, card.current && styles.current]}
            accessible
            accessibilityLabel={card.spoken}
          >
            <Text style={styles.label}>{card.label}</Text>
            {card.glyph ? (
              <Icon idea={card.glyph} size={22} color={theme.text} />
            ) : null}
            {card.temperature ? (
              <Text style={styles.temperature}>{card.temperature}</Text>
            ) : null}
            <View style={styles.bar}>
              <View
                style={[
                  styles.fill,
                  card.note !== null && styles.mutedFill,
                  { width: `${card.rainLevel * 100}%` },
                ]}
              />
            </View>
            <Text style={[styles.rain, card.rainLevel === 0 && styles.dry]}>
              {card.rain}
            </Text>
            {card.chance ? (
              <Text style={styles.meta}>{card.chance}</Text>
            ) : null}
            {card.wind ? <Text style={styles.meta}>{card.wind}</Text> : null}
            {card.note ? <Text style={styles.meta}>{card.note}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  rail: { gap: spacing(0.5) },
  heading: { flexDirection: "row", alignItems: "baseline", gap: spacing(1) },
  title: { ...textRole.control, color: theme.text, flexShrink: 1 },
  summary: { ...muted(theme, textRole.detail), fontVariant: ["tabular-nums"] },
  track: { gap: GAP },
  card: {
    alignItems: "center",
    gap: spacing(0.5),
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(0.5),
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: radius.md,
  },
  // The first card is told by ink and a firmer edge, not a fill.
  current: { borderColor: theme.textMuted },
  label: { ...textRole.caption, color: theme.text, textAlign: "center" },
  temperature: {
    ...textRole.control,
    color: theme.text,
    fontVariant: ["tabular-nums"],
  },
  bar: {
    alignSelf: "stretch",
    height: spacing(1),
    overflow: "hidden",
    borderRadius: radius.sm,
    backgroundColor: withAlpha(theme.text, wash.subtle),
  },
  fill: {
    height: "100%",
    borderRadius: radius.sm,
    backgroundColor: theme.accent,
  },
  // A figure the row's source didn't give (a gauge's modelled day).
  mutedFill: { backgroundColor: theme.textMuted },
  rain: {
    ...textRole.detail,
    color: theme.text,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  // None is a dash in the muted ink, so a wet card is the one with a figure.
  dry: { color: theme.textMuted },
  meta: {
    ...muted(theme, textRole.meta),
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
}));
