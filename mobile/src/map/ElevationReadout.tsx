// Gain/loss row for the measure and route-draw HUDs.
//
// Renders NOTHING until there is a profile: an empty row that later fills in
// reads as broken, and a "—" placeholder in a tool used offline would sit
// there permanently implying something is wrong. Absence is the honest state.
import { StyleSheet, Text, View } from "react-native";
import type { ElevationProfile } from "@logjam/shared";

import { fontSize, fontWeight, spacing, theme } from "../theme";

export function ElevationReadout({
  profile,
  loading,
}: {
  profile: ElevationProfile | null;
  loading: boolean;
}) {
  if (!profile) {
    return loading ? (
      <Text style={styles.pending}>Reading the terrain…</Text>
    ) : null;
  }
  return (
    <View style={styles.row}>
      <Text style={styles.value} accessibilityLabel={`Climb ${Math.round(profile.gainM)} metres`}>
        ↑ {Math.round(profile.gainM)} m
      </Text>
      <Text style={styles.value} accessibilityLabel={`Descent ${Math.round(profile.lossM)} metres`}>
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

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline", gap: spacing(1.25) },
  value: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  range: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  pending: { color: theme.textMuted, fontSize: fontSize.xs },
});
