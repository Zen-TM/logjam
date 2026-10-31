import { useState } from "react";
import {
  GAUGES,
  PLACE_PAGE,
  formatDistanceM,
  formatGaugeLevel,
  gaugeAgo,
  gaugeDisplayName,
  latestGaugeReading,
  nearbyGauges,
  tripDatesFor,
} from "@logjam/shared";
import { IconTile, Row } from "../../ui";
import { GaugeView } from "./GaugeView";
import classes from "./GaugeView.module.css";
import { TripGaugeReading } from "./TripGaugeReading";
import { useGauges } from "./useGauges";

const NEARBY = 8;

/**
 * The river gauge a place carries, from `PLACE_PAGE`: its reading, and for the
 * owner a way to choose, change or remove it. Nothing is preselected: the
 * nearest gauge is often on another river, so a person picks.
 */
export function PlaceGauge({
  latitude,
  longitude,
  gaugeId,
  owned,
  tripDates,
  onChange,
}: {
  latitude: number;
  longitude: number;
  gaugeId: string | null | undefined;
  owned: boolean;
  /** The dates of the viewer's own trips at this place. A sharee has none,
   *  and is never shown a trip reading whatever is passed. */
  tripDates: string[];
  onChange: (gaugeId: string | null) => void;
}) {
  const copy = PLACE_PAGE.copy;
  const [picking, setPicking] = useState(false);
  const { file, failed, now } = useGauges(owned || !!gaugeId);
  const chosen = gaugeId ? file?.gauges.find((g) => g.id === gaugeId) : null;
  const tile = <IconTile icon="gauge" hue="var(--color-accent)" />;
  return (
    <>
      {gaugeId &&
        (chosen && file ? (
          <>
            <TripGaugeReading
              gaugeIds={[gaugeId]}
              dates={tripDatesFor(owned, tripDates)}
              when="lastTrip"
              credit={false}
            />
            <GaugeView
              gauge={chosen}
              attribution={file.attribution}
              generatedAt={file.generatedAt}
              now={now}
            />
          </>
        ) : (
          <p className={classes.muted}>
            {failed
              ? GAUGES.copy.failed
              : file
                ? copy.gaugeMissing
                : copy.gaugeLoading}
          </p>
        ))}
      {owned && !picking && (
        <Row
          leading={tile}
          title={gaugeId ? copy.changeGauge : copy.chooseGauge}
          onOpen={() => setPicking(true)}
        />
      )}
      {owned && gaugeId && !picking && (
        <Row
          leading={tile}
          title={copy.removeGauge}
          onOpen={() => onChange(null)}
        />
      )}
      {owned && picking && !file && (
        <p className={classes.muted}>
          {failed ? GAUGES.copy.failed : copy.gaugeLoading}
        </p>
      )}
      {owned && picking && (
        <Row
          leading={<IconTile icon="close" hue="var(--color-accent)" />}
          title={copy.cancelPick}
          onOpen={() => setPicking(false)}
        />
      )}
      {owned && picking && file && (
        <>
          <p className={classes.muted}>{copy.gaugePickerHint}</p>
          {nearbyGauges(file.gauges, latitude, longitude, NEARBY).map(
            ({ gauge, distanceM }) => {
              const level = latestGaugeReading(gauge, now);
              return (
                <Row
                  key={gauge.id}
                  leading={tile}
                  title={gaugeDisplayName(gauge.name)}
                  subtitle={[
                    formatDistanceM(distanceM),
                    level?.level != null && level.levelAt != null
                      ? `${formatGaugeLevel(level.level)}, ${gaugeAgo(level.levelAt, now)}`
                      : GAUGES.copy.noLevel,
                  ].join(" · ")}
                  onOpen={() => {
                    setPicking(false);
                    onChange(gauge.id);
                  }}
                />
              );
            },
          )}
        </>
      )}
    </>
  );
}
