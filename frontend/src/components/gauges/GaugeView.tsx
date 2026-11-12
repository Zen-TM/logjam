import type { ReactNode } from "react";
import {
  GAUGES,
  contractSectionKeys,
  formatGaugeFlow,
  formatGaugeLevel,
  gaugeAges,
  gaugeDisplayName,
  gaugeFileNote,
  gaugeStats,
  gaugeWeekCharts,
  latestGaugeReading,
  type Gauge,
} from "@logjam/shared";
import { IconButton, ProfileChart, StatGrid } from "../../ui";
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
  onClose,
}: {
  gauge: Gauge;
  attribution: string;
  generatedAt: string;
  now: number;
  /** Given where the view is a surface of its own: the × beside the name. */
  onClose?: () => void;
}) {
  const latest = latestGaugeReading(gauge, now);
  const fileNote = gaugeFileNote(generatedAt, now);
  const ages = latest && gaugeAges(latest, now);
  const week = gaugeWeekCharts(gauge, latest);
  const sections: Record<
    (typeof GAUGES.sections)[number]["key"],
    () => ReactNode
  > = {
    reading: () =>
      latest && <StatGrid stats={gaugeStats(gauge, latest, now)} />,
    age: () =>
      ages ? (
        (ages.line || fileNote) && (
          <p className={classes.muted}>
            {ages.line}
            {ages.line && fileNote && " · "}
            {fileNote}
          </p>
        )
      ) : (
        <p className={classes.muted}>
          {GAUGES.copy.noRecent}
          {fileNote && <> {fileNote}.</>}
        </p>
      ),
    graph: () =>
      week.length > 0 ? (
        <section>
          <h3 className={classes.graphTitle}>{GAUGES.copy.graph}</h3>
          {week.map(({ charted, series }) => (
            <div key={charted}>
              <p className={classes.muted}>{GAUGES.copy[charted]}</p>
              <ProfileChart
                series={series}
                formatValue={
                  charted === "level" ? formatGaugeLevel : formatGaugeFlow
                }
                formatX={(x) => DAY_FORMAT.format(x)}
                label={`${GAUGES.copy[charted]}, ${GAUGES.copy.graph.toLowerCase()}`}
                color="var(--color-accent)"
              />
            </div>
          ))}
        </section>
      ) : null,
    credit: () => (
      <p className={classes.credit}>{attribution || GAUGES.copy.credit}</p>
    ),
  };
  return (
    <div className={classes.view}>
      <div className={classes.head}>
        <h2 className={classes.name}>{gaugeDisplayName(gauge.name)}</h2>
        {onClose && <IconButton icon="close" label="Close" onClick={onClose} />}
      </div>
      {contractSectionKeys(GAUGES, "web").map((key) => (
        <div key={key}>{sections[key]()}</div>
      ))}
    </div>
  );
}
