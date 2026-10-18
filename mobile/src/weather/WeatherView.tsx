// The weather at a spot, drawn from `WEATHER` (shared/src/contracts/weather.ts):
// the same view in the map's point panel and on a place's page.
//
// PRIVACY: nothing here is logged, and the credit link carries no position.
import { Linking, Pressable, Text, View } from "react-native";
import {
  WEATHER,
  WEATHER_CREDIT_URL,
  formatRainMm,
  weatherAge,
  weatherDayFacts,
  type SectionKeysOn,
  type WeatherDay,
  type WeatherForecast,
} from "@logjam/shared";

import {
  hitSlop,
  makeStyles,
  muted,
  radius,
  spacing,
  useTheme,
} from "../theme";
import { Button, Icon, StatGrid } from "../ui";
import type { Weather } from "./useWeather";
import { weatherViewState } from "./weatherState";

type SectionProps = {
  forecast: WeatherForecast;
  days: WeatherDay[];
  now: number;
};

/** One drawing per contract section; `tsc` and `weather.test.ts` hold the set. */
export const WEATHER_SECTIONS: Record<
  SectionKeysOn<typeof WEATHER, "gps">,
  (props: SectionProps) => React.ReactNode
> = {
  pastRain: ({ forecast }) => (
    <StatGrid
      stats={[
        {
          label: WEATHER.copy.pastRain,
          value: formatRainMm(forecast.pastRainMm),
          span: true,
        },
      ]}
    />
  ),
  days: ({ days, now }) => <DayRows days={days} now={now} />,
  credit: () => <Credit />,
};

export function WeatherView({ weather }: { weather: Weather }) {
  const styles = useStyles();
  const { now } = weather;
  const state = weatherViewState(weather);
  const copy = WEATHER.copy;

  if (state.kind === "loading")
    return <Text style={styles.note}>{copy.loading}</Text>;
  if (state.kind === "needsConnection")
    return <Text style={styles.note}>{copy.needsConnection}</Text>;
  if (state.kind === "failed")
    return (
      <View style={styles.stack}>
        <Text style={styles.note}>{copy.failed}</Text>
        {state.canRetry ? (
          <Button
            label="Try again"
            variant="outlineAccent"
            compact
            onPress={weather.refresh}
          />
        ) : null}
      </View>
    );

  const { forecast } = state;
  const days = state.kind === "forecast" ? state.days : [];
  return (
    <View style={styles.stack}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.note}>{weatherAge(forecast.fetchedAt, now)}</Text>
          {!weather.canFetch ? (
            <Text style={styles.note}>{copy.needsConnection}</Text>
          ) : weather.status === "failed" ? (
            <Text style={styles.note}>{copy.failed}</Text>
          ) : null}
        </View>
        <Button
          label={copy.refresh}
          icon="refresh"
          variant="outlineAccent"
          compact
          disabled={!weather.canFetch}
          disabledReason={copy.needsConnection}
          loading={weather.status === "loading"}
          onPress={weather.refresh}
        />
      </View>
      {WEATHER.sections.map(({ key }) => {
        if (key === "days" && state.kind === "outOfDate")
          return (
            <Text key={key} style={styles.note}>
              {copy.outOfDate}
            </Text>
          );
        return (
          <View key={key}>
            {WEATHER_SECTIONS[key]({ forecast, days, now })}
          </View>
        );
      })}
    </View>
  );
}

function DayRows({ days, now }: { days: WeatherDay[]; now: number }) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.days}>
      {days.map((day) => {
        const facts = weatherDayFacts(day, now);
        const today = facts.day === WEATHER.copy.today;
        return (
          <View
            key={facts.date}
            style={[styles.day, today && styles.today]}
            accessible
            accessibilityLabel={`${facts.day}, ${facts.condition.label}, ${facts.temperature}, rain ${facts.rain}, wind ${facts.wind}`}
          >
            <Text style={[styles.dayName, today && styles.emphasis]}>
              {facts.day}
            </Text>
            <Icon
              idea={facts.condition.icon}
              size={22}
              color={theme.text}
              label={facts.condition.label}
            />
            <Text style={[styles.cell, styles.temp, today && styles.emphasis]}>
              {facts.temperature}
            </Text>
            <Text style={[styles.cell, styles.rain]}>{facts.rain}</Text>
            <Text style={[styles.cell, styles.wind]}>{facts.wind}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Credit() {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="link"
      hitSlop={hitSlop}
      onPress={() => void Linking.openURL(WEATHER_CREDIT_URL)}
    >
      <Text style={styles.credit}>{WEATHER.copy.credit}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  stack: { gap: spacing(1.5) },
  header: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  headerText: { flex: 1 },
  note: { ...muted(theme, textRole.detail) },
  days: { gap: spacing(0.5) },
  // Read-only rows have no fill: the card colour means "press me". Today is
  // set apart by its edge and weight instead.
  day: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1),
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: radius.md,
  },
  today: { borderColor: theme.accent },
  dayName: {
    ...textRole.detail,
    color: theme.text,
    width: spacing(6),
    fontVariant: ["tabular-nums"],
  },
  emphasis: { ...textRole.control },
  cell: {
    ...textRole.detail,
    color: theme.text,
    fontVariant: ["tabular-nums"],
  },
  temp: { flex: 3 },
  rain: { flex: 5 },
  wind: { flex: 3, textAlign: "right" },
  credit: {
    ...muted(theme, textRole.meta),
    textDecorationLine: "underline",
    textAlign: "center",
  },
}));
