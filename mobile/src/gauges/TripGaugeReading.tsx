// What the gauges of some places read on a trip's date, beside what they read
// now (`tripGaugeLines`). Looked up for display, never stored. Draws nothing
// until it has a line to show. `credit` is false where a `GaugeBody` below
// already draws the notice.
import { useState } from "react";
import { Text, View } from "react-native";
import { GAUGES, tripGaugeLines } from "@logjam/shared";

import { makeStyles, muted, spacing } from "../theme";
import { SectionHeader } from "../ui";
import { useGaugeHistories } from "./useGaugeHistories";
import { useGauges } from "./useGauges";

export function TripGaugeReading({
  gaugeIds,
  dates,
  when,
  title,
  credit = true,
}: {
  gaugeIds: string[];
  dates: string[];
  when: "trip" | "lastTrip";
  title?: string;
  credit?: boolean;
}) {
  const styles = useStyles();
  const [now] = useState(Date.now);
  const enabled = gaugeIds.length > 0 && dates.length > 0;
  const { file } = useGauges(enabled);
  const histories = useGaugeHistories(enabled ? gaugeIds : []);
  if (!file || !histories) return null;
  const inputs = gaugeIds.flatMap((id) => {
    const gauge = file.gauges.find((g) => g.id === id);
    return gauge ? [{ gauge, history: histories[id] ?? null }] : [];
  });
  const lines = tripGaugeLines(inputs, dates, when, now);
  if (lines.length === 0) return null;
  return (
    <View style={styles.stack}>
      {title && <SectionHeader title={title} />}
      {lines.map((line) => (
        <Text key={line} style={styles.note}>
          {line}
        </Text>
      ))}
      {credit && (
        <Text style={styles.note}>
          {file.attribution || GAUGES.copy.credit}
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  stack: { gap: spacing(1) },
  note: { ...muted(theme, textRole.detail) },
}));
