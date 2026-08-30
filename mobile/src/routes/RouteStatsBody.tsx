// What a route IS, as numbers — distance, climb and descent, the height band,
// and the elevation profile.
//
// Split out of the old standalone RouteStatsSheet for the same reason
// `tracks/TrackStatsBody.tsx` was: the stats are a SUB-MODE of the route's
// options sheet now (DESIGN.md §7), not a sheet of their own, so the body has
// to be mountable inside someone else's `BottomSheet`.
//
// It owns its own elevation hook rather than taking a profile prop — unlike a
// track's body, which is also rendered for a LIVE recording whose caller
// already holds the series, a route has exactly one render site and the
// heights come from one place.
//
// Elevation is fetched on demand and is simply absent offline (see
// useElevationProfile) — the distance is always right, which is the number
// being looked for most of the time.
import { StyleSheet, Text, View } from "react-native";
import { formatDistanceM, routeLengthM } from "@logjam/shared";

import { fontSize, fontWeight, spacing, theme } from "../theme";
import { ProfileChart, elevationSeries } from "../ui";
import { useElevationProfile } from "../map/useElevationProfile";
import { SHARED_READ_ONLY_HINT } from "../saved/assetActions";
import type { MirrorRoute } from "../sync/mirrorStore";

export function RouteStatsBody({
  route,
  allowNetwork = true,
}: {
  route: MirrorRoute;
  /**
   * False in "Simulating offline mode": elevation then comes only from tiles
   * already on the phone, and nothing goes out.
   */
  allowNetwork?: boolean;
}) {
  const { profile, loading } = useElevationProfile([route.points], { allowNetwork });

  return (
    <View style={styles.body}>
      <View style={styles.statRow}>
        <Stat label="Distance" value={formatDistanceM(routeLengthM(route.points))} />
        <Stat label="Climb" value={profile ? `↑ ${Math.round(profile.gainM)} m` : "—"} />
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
            hint="Press or drag for heights."
            accessibilityLabel="Elevation profile"
          />
        </>
      ) : (
        <Text style={styles.pending}>
          {loading
            ? "Reading the terrain…"
            : "Elevation needs a connection; distance always shows."}
        </Text>
      )}

      {route.syncRole === "shared" ? (
        <Text style={styles.note}>{SHARED_READ_ONLY_HINT}</Text>
      ) : null}
    </View>
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
