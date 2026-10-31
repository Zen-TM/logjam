// A river gauge's last reading, drawn from `GAUGES` (shared/contracts): the
// level, the flow where the gauge has one, how old the reading is, the week as
// a chart, and the credit. Readings only; it never says what they mean.
import { Fragment, type ReactNode } from "react";
import { Text, View } from "react-native";
import {
  GAUGES,
  contractSectionKeys,
  formatGaugeFlow,
  formatGaugeLevel,
  gaugeAges,
  gaugeDisplayName,
  gaugeFileNote,
  gaugeStats,
  gaugeWeekChart,
  latestGaugeReading,
  type Gauge,
  type ProfileSeries,
  type SectionKeysOn,
} from "@logjam/shared";

import { makeStyles, muted, spacing } from "../theme";
import { BottomSheet, ProfileChart, StatGrid } from "../ui";

const DAY_FORMAT = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** The chart draws x from 0 (its first column sits at x = 0 and reads a
 *  series that starts later as flat), so the week is shifted to start there;
 *  `start` is added back to read a position out. */
export function fromZero(series: ProfileSeries): {
  series: ProfileSeries;
  start: number;
} {
  const start = series.points[0]?.x ?? 0;
  return {
    series: {
      ...series,
      points: series.points.map((p) => ({ ...p, x: p.x - start })),
    },
    start,
  };
}

type Props = {
  gauge: Gauge;
  attribution: string;
  generatedAt: string;
  now: number;
};

/** One drawing per contract section; `tsc` and gauges.test.ts hold the set. */
export const GAUGE_SECTIONS: Record<
  SectionKeysOn<typeof GAUGES, "gps">,
  (props: Props & { styles: ReturnType<typeof useStyles> }) => ReactNode
> = {
  reading: ({ gauge, now }) => {
    const latest = latestGaugeReading(gauge, now);
    return latest ? <StatGrid stats={gaugeStats(gauge, latest, now)} /> : null;
  },
  age: ({ gauge, generatedAt, now, styles }) => {
    const latest = latestGaugeReading(gauge, now);
    const note = gaugeFileNote(generatedAt, now);
    const line = latest ? gaugeAges(latest, now).line : GAUGES.copy.noRecent;
    const text = [line, note].filter(Boolean).join(" · ");
    return text ? <Text style={styles.note}>{text}</Text> : null;
  },
  graph: ({ gauge, now, styles }) => {
    const week = gaugeWeekChart(gauge, latestGaugeReading(gauge, now));
    const shifted = week && fromZero(week.series);
    return week && shifted ? (
      <>
        <Text style={styles.title}>{GAUGES.copy.graph}</Text>
        <ProfileChart
          series={shifted.series}
          formatValue={
            week.charted === "level" ? formatGaugeLevel : formatGaugeFlow
          }
          formatX={(x) => DAY_FORMAT.format(x + shifted.start)}
          hint="Press or drag for readings."
          accessibilityLabel={`${GAUGES.copy[week.charted]}, ${GAUGES.copy.graph.toLowerCase()}`}
        />
      </>
    ) : null;
  },
  credit: ({ attribution, styles }) => (
    <Text style={styles.note}>{attribution || GAUGES.copy.credit}</Text>
  ),
};

export function GaugeSheet({
  gauge,
  onClose,
  ...rest
}: Omit<Props, "gauge"> & { gauge: Gauge | null; onClose: () => void }) {
  const styles = useStyles();
  return (
    <BottomSheet
      visible={gauge !== null}
      onClose={onClose}
      title={gauge ? gaugeDisplayName(gauge.name) : GAUGES.title}
    >
      {gauge ? (
        <View style={styles.stack}>
          {contractSectionKeys(GAUGES, "gps").map((key) => (
            <Fragment key={key}>
              {GAUGE_SECTIONS[key]({ ...rest, gauge, styles })}
            </Fragment>
          ))}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  stack: { gap: spacing(1.5) },
  note: { ...muted(theme, textRole.detail) },
  title: { ...textRole.rowTitle, color: theme.text },
}));
