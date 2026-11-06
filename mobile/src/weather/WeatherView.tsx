// The weather at a spot, drawn from `WEATHER` (shared/src/contracts/weather.ts):
// the same view in the map's point panel and on a place's page.
//
// PRIVACY: nothing here is logged, and the credit link carries no position.
import { Linking, Pressable, Text, View } from "react-native";
import {
  WEATHER,
  WEATHER_CREDIT_URL,
  WEATHER_MODELS,
  weatherAge,
  weatherRows,
  type SectionKeysOn,
  type WeatherForecast,
  type WeatherRow,
} from "@logjam/shared";

import { hitSlop, makeStyles, muted, spacing } from "../theme";
import { Button, ChipRail, ForecastRail } from "../ui";
import type { Weather } from "./useWeather";
import { weatherViewState } from "./weatherState";

type SectionProps = {
  forecast: WeatherForecast;
  rows: WeatherRow[];
};

function RowSection({
  rows,
  row,
}: {
  rows: WeatherRow[];
  row: WeatherRow["key"];
}) {
  const found = rows.find((r) => r.key === row);
  return found ? (
    <ForecastRail
      title={found.title}
      summary={found.summary}
      cards={found.cards}
    />
  ) : null;
}

/** One drawing per contract section; `tsc` and `weatherContracts.test.ts` hold the set. */
export const WEATHER_SECTIONS: Record<
  SectionKeysOn<typeof WEATHER, "gps">,
  (props: SectionProps) => React.ReactNode
> = {
  hours: ({ rows }) => <RowSection rows={rows} row="hours" />,
  days: ({ rows }) => <RowSection rows={rows} row="days" />,
  past: ({ rows }) => <RowSection rows={rows} row="past" />,
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
            label={copy.tryAgain}
            variant="outlineAccent"
            compact
            onPress={weather.refresh}
          />
        ) : null}
      </View>
    );

  const { forecast } = state;
  const rows = weatherRows(forecast, now);
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
      <View style={styles.model}>
        <Text style={styles.note}>{copy.modelHint}</Text>
        <ChipRail
          options={WEATHER_MODELS.map(({ id, label }) => ({
            value: id,
            label,
            // Offline a choice could only show nothing (shared/DESIGN.md §5).
            disabled: !weather.canFetch,
          }))}
          value={weather.model}
          onChange={weather.chooseModel}
          // One line that scrolls sideways (maintainer's call): a wrapped
          // block pushed the forecast down, most in the map point sheet.
          scroll
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
          <View key={key}>{WEATHER_SECTIONS[key]({ forecast, rows })}</View>
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
  model: { gap: spacing(1) },
  note: { ...muted(theme, textRole.detail) },
  credit: {
    ...muted(theme, textRole.meta),
    textDecorationLine: "underline",
    textAlign: "center",
  },
}));
