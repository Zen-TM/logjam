import type { ReactNode } from "react";
import {
  GAUGES,
  contractSectionKeys,
  formatGaugeFlow,
  formatGaugeLevel,
  gaugeAgo,
  gaugeDisplayName,
  gaugeFileNote,
  gaugeSeries,
  latestGaugeReading,
  type Gauge,
} from "@logjam/shared";
import { ProfileChart, StatGrid } from "../../ui";
import classes from "./GaugeView.module.css";

const DAY_FORMAT = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * A gauge's last reading, drawn from `GAUGES` (shared/contracts): the level,
 * the flow where the gauge has one, how old the reading is, the week as a
 * chart, and the credit. Readings only; it never says what they mean.
 */
export function GaugeView({
  gauge,
  attribution,
  generatedAt,
  now,
}: {
  gauge: Gauge;
  attribution: string;
  generatedAt: string;
  now: number;
}) {
  const latest = latestGaugeReading(gauge, now);
  const fileNote = gaugeFileNote(generatedAt, now);
  // A gauge with a level draws its level; one with only a flow draws that.
  const levelSeries = gaugeSeries(gauge.readings, "level");
  const flowSeries = gaugeSeries(gauge.readings, "flow");
  const charted = levelSeries.min !== null ? "level" : "flow";
  const series = charted === "level" ? levelSeries : flowSeries;
  const sections: Record<
    (typeof GAUGES.sections)[number]["key"],
    () => ReactNode
  > = {
    level: () =>
      latest && (
        <StatGrid
          stats={[
            {
              label: GAUGES.copy.level,
              value:
                latest.level === null
                  ? GAUGES.copy.noLevel
                  : formatGaugeLevel(latest.level),
              span: !gauge.hasFlow,
            },
          ]}
        />
      ),
    flow: () =>
      latest &&
      gauge.hasFlow && (
        <StatGrid
          stats={[
            {
              label: GAUGES.copy.flow,
              value: latest.flow === null ? "-" : formatGaugeFlow(latest.flow),
            },
          ]}
        />
      ),
    age: () =>
      latest ? (
        <p className={classes.muted}>
          {GAUGES.copy.age} {gaugeAgo(latest.at, now)}
          {fileNote && <> · {fileNote}</>}
        </p>
      ) : (
        <p className={classes.muted}>
          {GAUGES.copy.noRecent}
          {fileNote && <> {fileNote}.</>}
        </p>
      ),
    graph: () =>
      latest && series.min !== null ? (
        <section>
          <h3 className={classes.graphTitle}>{GAUGES.copy.graph}</h3>
          <ProfileChart
            series={series}
            formatValue={
              charted === "level" ? formatGaugeLevel : formatGaugeFlow
            }
            formatX={(x) => DAY_FORMAT.format(x)}
            label={`${GAUGES.copy[charted]}, ${GAUGES.copy.graph.toLowerCase()}`}
            color="var(--color-accent)"
          />
        </section>
      ) : null,
    credit: () => (
      <p className={classes.credit}>{attribution || GAUGES.copy.credit}</p>
    ),
  };
  return (
    <div className={classes.view}>
      <h2 className={classes.name}>{gaugeDisplayName(gauge.name)}</h2>
      {contractSectionKeys(GAUGES, "web").map((key) => (
        <div key={key}>{sections[key]()}</div>
      ))}
    </div>
  );
}
