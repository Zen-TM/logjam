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

import { hitSlop, makeStyles, muted, spacing } from "../theme";
import { Button, ForecastList, StatGrid, type ForecastRow } from "../ui";
import type { Weather } from "./useWeather";
import { weatherViewState } from "./weatherState";

type SectionProps = {
  forecast: WeatherForecast;
  days: WeatherDay[];
  now: number;
};

/** One drawing per contract section; `tsc` and `weatherContracts.test.ts` hold the set. */
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
  const rows = days.map((day): ForecastRow => {
    const facts = weatherDayFacts(day, now);
    return {
      key: facts.date,
      day: facts.day,
      glyph: facts.condition.icon,
      glyphLabel: facts.condition.label,
      temperature: facts.temperature,
      rain: facts.rain,
      wind: facts.wind,
      current: facts.day === WEATHER.copy.today,
    };
  });
  return <ForecastList rows={rows} label={WEATHER.title} />;
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
  credit: {
    ...muted(theme, textRole.meta),
    textDecorationLine: "underline",
    textAlign: "center",
  },
}));
