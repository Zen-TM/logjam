// What a route IS, shown when one is tapped on the map.
//
// The mobile counterpart of the web's route detail panel: distance, climb and
// descent, the height band, and the elevation profile. Read-only by design —
// every verb lives one tap further on, behind "View options", so tapping a
// line on the map can never be the first half of an accidental edit.
//
// Elevation is fetched on demand and is simply absent offline (see
// useElevationProfile) — the distance is always right, which is the number
// being looked for most of the time.
import { StyleSheet, Text, View } from "react-native";
import { formatDistanceM, routeLengthM } from "@logjam/shared";

import { fontSize, fontWeight, spacing, theme } from "../theme";
import { BottomSheet, Button, ProfileChart, elevationSeries } from "../ui";
import { useElevationProfile } from "../map/useElevationProfile";
import type { MirrorRoute } from "../sync/mirrorStore";

export function RouteStatsSheet({
  route,
  visible,
  onClose,
  onViewOptions,
  allowNetwork = true,
}: {
  route: MirrorRoute | null;
  visible: boolean;
  onClose: () => void;
  onViewOptions: () => void;
  /**
   * False in "Simulating offline mode": elevation then comes only from tiles
   * already on the phone, and nothing goes out.
   */
  allowNetwork?: boolean;
}) {
  // Hooks run before the early return — an empty point list makes no request.
  const { profile, loading } = useElevationProfile(route?.points ?? [], { allowNetwork });
  if (!route) return null;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={route.name}>
      <View style={styles.body}>
        <View style={styles.statRow}>
          <Stat label="Distance" value={formatDistanceM(routeLengthM(route.points))} />
          <Stat
            label="Climb"
            value={profile ? `↑ ${Math.round(profile.gainM)} m` : "—"}
          />
          <Stat
            label="Descent"
            value={profile ? `↓ ${Math.round(profile.lossM)} m` : "—"}
          />
        </View>

        {profile?.minM != null && profile.maxM != null ? (
          <Text style={styles.band}>
            {Math.round(profile.minM)}–{Math.round(profile.maxM)} m above sea level
          </Text>
        ) : null}

        {profile ? (
          <>
            {/* The chart's own axes named, as on a track's stats — an unlabelled
                height profile is read as a height-over-TIME by anyone who has
                not been told otherwise. */}
            <Text style={styles.chartLabel}>Elevation vs distance</Text>
            <ProfileChart
              series={elevationSeries(profile)}
              formatValue={(elevationM) => `${Math.round(elevationM)} m`}
              formatX={formatDistanceM}
              hint="Drag across for the height at a point along the route"
              accessibilityLabel="Elevation profile"
            />
          </>
        ) : (
          <Text style={styles.pending}>
            {loading
              ? "Reading the terrain…"
              : "Elevation needs a connection — distance is always available."}
          </Text>
        )}

        {route.syncRole === "shared" ? (
          <Text style={styles.note}>
            Shared with you — you can view and export it, but not change it.
          </Text>
        ) : null}

        <Button label="View options" icon="more-horizontal" onPress={onViewOptions} />
      </View>
    </BottomSheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chartLabel: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  body: { gap: spacing(1.5) },
  statRow: { flexDirection: "row", gap: spacing(2) },
  stat: { gap: spacing(0.25) },
  statValue: {
    color: theme.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  band: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  pending: { color: theme.textMuted, fontSize: fontSize.sm },
  note: { color: theme.textMuted, fontSize: fontSize.xs },
});
