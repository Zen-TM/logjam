// Gain/loss row for the measure and route-draw HUDs.
//
// Renders NOTHING until there is a profile: an empty row that later fills in
// reads as broken, and a "—" placeholder in a tool used offline would sit
// there permanently implying something is wrong. Absence is the honest state.
import { Text, View } from "react-native";
import { MAP_MEASURE, type ElevationProfile } from "@logjam/shared";

import { fontSize, spacing, makeStyles } from "../theme";

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
  return (
    <View style={styles.row}>
      <Text
        style={styles.value}
        accessibilityLabel={`Ascent ${Math.round(profile.gainM)} metres`}
      >
        ↑ {Math.round(profile.gainM)} m
      </Text>
      <Text
        style={styles.value}
        accessibilityLabel={`Descent ${Math.round(profile.lossM)} metres`}
      >
        ↓ {Math.round(profile.lossM)} m
      </Text>
      {profile.minM != null && profile.maxM != null ? (
        <Text style={styles.range}>
          {Math.round(profile.minM)}–{Math.round(profile.maxM)} m
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  row: { flexDirection: "row", alignItems: "baseline", gap: spacing(0.5) },
  value: {
    ...textRole.control,
    color: theme.text,
    fontVariant: ["tabular-nums"],
  },
  range: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  pending: { color: theme.textMuted, fontSize: fontSize.xs },
}));
