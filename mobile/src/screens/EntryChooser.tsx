// First thing a fresh install shows: sign in, or carry on without an account.
//
// Most of Logjam does not need a server. Canyons, trip logs, waypoints, photos,
// recorded tracks, local GeoPDF import, measure and compass are all local
// SQLite and local files. Putting a sign-up wall in front of that asked people
// to hand over an email before they could write down where they'd been, in an
// app whose whole premise is that this data is nobody else's business.
//
// Two things on this screen are load-bearing rather than decorative:
//
//  1. **The storage warning.** Guest data is on this phone and nowhere else —
//     `allowBackup: false` (app.json) means not even Android's cloud backup
//     holds a copy, which is the correct privacy posture and also means a lost
//     phone is total loss. Saying so here is the only honest place; by the time
//     someone has a season of trips recorded it is too late to mention.
//  2. **The crash-report toggle, defaulting off.** Root CLAUDE.md forbids
//     telemetry leaving the user's account, and a guest has no account for it
//     to leave to. Asking is the only way to honour that, so the reporter stays
//     dark until this is answered (see sentry/crashReportPreference.ts).
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { setCrashReportsEnabled } from "../sentry/crashReportPreference";
import { fontSize, fontWeight, spacing, radius, surface, theme, withAlpha } from "../theme";
import { Button, ErrorBanner, Toggle } from "../ui";

export function EntryChooser({
  onContinueAsGuest,
  onSignIn,
  error,
}: {
  /** Returns false when the choice could not be stored (the caller says why). */
  onContinueAsGuest: () => boolean;
  onSignIn: () => void;
  error: string | null;
}) {
  const [crashReports, setCrashReports] = useState(false);

  // Whichever way they go, the crash-report answer is recorded — someone who
  // signs in has answered it too, and re-prompting them later would be asking
  // a question they've already been shown.
  const commitCrashReportChoice = () => {
    setCrashReportsEnabled(crashReports);
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={styles.appTitle}>Logjam</Text>
      <Text style={styles.tagline}>Your canyoning logbook and offline maps.</Text>

      {error ? (
        <View style={styles.bannerSlot}>
          <ErrorBanner message={error} />
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label="Continue without an account"
          variant="filledAccent"
          onPress={() => {
            commitCrashReportChoice();
            onContinueAsGuest();
          }}
        />
        <Button
          label="Sign in or create an account"
          variant="outlineAccent"
          onPress={() => {
            commitCrashReportChoice();
            onSignIn();
          }}
        />
      </View>

      <View style={styles.noteCard}>
        <View style={styles.noteHead}>
          <Feather name="smartphone" size={16} color={theme.accent} />
          <Text style={styles.noteTitle}>Without an account</Text>
        </View>
        <Text style={styles.noteBody}>
          Everything you record stays on this phone and is never uploaded. It is
          not backed up anywhere — if you lose this phone, you lose it. Creating
          an account later keeps what you&apos;ve already recorded.
        </Text>
        <Text style={styles.noteBody}>
          Sharing canyons with friends, LiDAR maps from your web account, and
          the detailed vector basemap download all need an account. Downloaded
          topographic and aerial maps work without one.
        </Text>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <Text style={styles.toggleTitle}>Send crash reports</Text>
          <Text style={styles.toggleSubtitle}>
            Anonymous, and scrubbed of canyon names and coordinates. Off by
            default. You can change this in Settings.
          </Text>
        </View>
        <Toggle
          value={crashReports}
          onValueChange={setCrashReports}
          accessibilityLabel="Send crash reports"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing(3),
    gap: spacing(2),
  },
  appTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: theme.textPrimary,
    textAlign: "center",
  },
  tagline: {
    fontSize: fontSize.base,
    color: theme.textMuted,
    textAlign: "center",
    marginTop: -spacing(1),
  },
  bannerSlot: { marginTop: spacing(1) },
  actions: { gap: spacing(1), marginTop: spacing(1) },
  noteCard: {
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: surface.border,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    gap: spacing(1),
  },
  noteHead: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  noteTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: theme.textPrimary,
  },
  noteBody: { fontSize: fontSize.sm, color: theme.textMuted, lineHeight: 20 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    backgroundColor: withAlpha(theme.textPrimary, 0.04),
    borderRadius: radius.lg,
    padding: spacing(1.5),
  },
  toggleText: { flex: 1, gap: spacing(0.25) },
  toggleTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: theme.textPrimary,
  },
  toggleSubtitle: { fontSize: fontSize.sm, color: theme.textMuted },
});
