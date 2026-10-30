// The river gauge a place carries, from `PLACE_PAGE`: its reading, and for the
// owner a way to choose, change or remove it. Nothing is preselected: the
// nearest gauge is often on another river, so a person picks.
import { useState } from "react";
import { Text } from "react-native";
import {
  GAUGES,
  PLACE_PAGE,
  formatDistanceM,
  formatGaugeLevel,
  gaugeAgo,
  gaugeDisplayName,
  latestGaugeReading,
  nearbyGauges,
} from "@logjam/shared";

import { makeStyles, muted } from "../theme";
import { BottomSheet, Row } from "../ui";
import { GaugeBody } from "./GaugeSheet";
import { useGauges } from "./useGauges";

const NEARBY = 8;

export function PlaceGaugeSection({
  latitude,
  longitude,
  gaugeId,
  owned,
  onChange,
}: {
  latitude: number;
  longitude: number;
  gaugeId: string | null | undefined;
  owned: boolean;
  onChange: (gaugeId: string | null) => void;
}) {
  const copy = PLACE_PAGE.copy;
  const styles = useStyles();
  const [picking, setPicking] = useState(false);
  const [now] = useState(Date.now);
  const { file, settled } = useGauges(owned || !!gaugeId);
  const chosen = gaugeId ? file?.gauges.find((g) => g.id === gaugeId) : null;
  return (
    <>
      {gaugeId &&
        (chosen && file ? (
          <>
            <Text style={styles.note}>{gaugeDisplayName(chosen.name)}</Text>
            <GaugeBody
              gauge={chosen}
              attribution={file.attribution}
              generatedAt={file.generatedAt}
              now={now}
            />
          </>
        ) : (
          <Text style={styles.note}>
            {file
              ? copy.gaugeMissing
              : settled
                ? GAUGES.copy.failed
                : copy.gaugeLoading}
          </Text>
        ))}
      {owned && (
        <Row
          icon="place"
          title={gaugeId ? copy.changeGauge : copy.chooseGauge}
          onPress={() => setPicking(true)}
        />
      )}
      {owned && gaugeId && (
        <Row
          icon="place"
          title={copy.removeGauge}
          onPress={() => onChange(null)}
        />
      )}
      <BottomSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title={copy.chooseGauge}
      >
        <Text style={styles.note}>
          {file
            ? copy.gaugePickerHint
            : settled
              ? GAUGES.copy.failed
              : copy.gaugeLoading}
        </Text>
        {file
          ? nearbyGauges(file.gauges, latitude, longitude, NEARBY).map(
              ({ gauge, distanceM }) => {
                const level = latestGaugeReading(gauge, now);
                return (
                  <Row
                    key={gauge.id}
                    icon="place"
                    title={gaugeDisplayName(gauge.name)}
                    subtitle={[
                      formatDistanceM(distanceM),
                      level?.level != null && level.levelAt != null
                        ? `${formatGaugeLevel(level.level)}, ${gaugeAgo(level.levelAt, now)}`
                        : GAUGES.copy.noLevel,
                    ].join(" · ")}
                    onPress={() => {
                      setPicking(false);
                      onChange(gauge.id);
                    }}
                  />
                );
              },
            )
          : null}
      </BottomSheet>
    </>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  note: { ...muted(theme, textRole.detail) },
}));
