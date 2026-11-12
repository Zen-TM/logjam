import { useState } from "react";
import { GAUGES, tripGaugeLines } from "@logjam/shared";
import { SectionHeader } from "../../ui";
import classes from "./GaugeView.module.css";
import { useGaugeHistories } from "./useGaugeHistories";
import { useGauges } from "./useGauges";

/**
 * What the gauges of some places read on a trip's date, beside what they read
 * now (`tripGaugeLines`). Looked up for display, never stored. Draws nothing
 * until it has a line to show. `credit` is false where a `GaugeView` below
 * already draws the notice.
 */
export function TripGaugeReading({
  gaugeIds,
  dates,
  when,
  title,
  credit = true,
  className,
}: {
  gaugeIds: string[];
  dates: string[];
  when: "trip" | "lastTrip";
  title?: string;
  credit?: boolean;
  className?: string;
}) {
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
    <section className={className}>
      {title && <SectionHeader title={title} />}
      {lines.map((line) => (
        <p key={line} className={classes.muted}>
          {line}
        </p>
      ))}
      {credit && (
        <p className={classes.credit}>
          {file.attribution || GAUGES.copy.credit}
        </p>
      )}
    </section>
  );
}
