// Gain/loss row for the measure and route-draw HUDs.
//
// Renders NOTHING until there is a profile: an empty row that later fills in
// reads as broken, and a "—" placeholder in a tool used offline would sit
// there permanently implying something is wrong. Absence is the honest state.
import { Text, View } from "react-native";
import {
  MAP_MEASURE,
  mapMeasureFacts,
  mapMeasureRange,
  type ElevationProfile,
} from "@logjam/shared";

import { spacing, makeStyles, muted } from "../theme";

export function ElevationReadout({
  profile,
  loading,
}: {
  profile: ElevationProfile | null;
  loading: boolean;
}) {
  const styles = useStyles();

  if (!profile) {
    return loading ? (
      <Text style={styles.pending}>{MAP_MEASURE.copy.readingTerrain}</Text>
    ) : null;
  }
  const copy = MAP_MEASURE.copy;
  const range = mapMeasureRange(profile);
  // Spelled out as on Logjam Web ("Ascent ↑ 27 m"): an arrow alone is a
  // guess, and a bare "811–918 m" does not say it is the height. Wraps rather
  // than clips at large text sizes.
  return (
    <View style={styles.row}>
      {mapMeasureFacts({ points: [], terrain: profile })
        .filter((fact) => fact.key !== "distance")
        .map((fact) => (
          <Text
            key={fact.key}
            style={styles.value}
            accessibilityLabel={fact.spoken}
          >
            <Text style={styles.label}>{fact.label} </Text>
            {fact.value}
          </Text>
        ))}
      {range ? (
        <Text style={styles.label}>
          {range} {copy.aboveSeaLevel}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: spacing(1.5),
  },
  value: {
    ...textRole.control,
    color: theme.text,
    fontVariant: ["tabular-nums"],
  },
  label: {
    ...muted(theme, textRole.detail),
    fontVariant: ["tabular-nums"],
  },
  pending: { ...muted(theme, textRole.meta) },
}));
