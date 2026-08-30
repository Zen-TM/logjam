// The crash-report question, asked ONCE, once the user is actually in the app —
// for a guest and for a signed-in user alike (App.tsx mounts it beside
// AppShell). It used to be a toggle on the entry screen, where it competed with
// the one decision that screen exists for and was answered by people who had
// not yet seen the app they were consenting on behalf of.
//
// The guarantee it inherits is unchanged (see crashReportPreference.ts):
// `initSentry()` no-ops until the question is answered, the default is OFF, and
// an explicit "no" is never overwritten. "Not now" is a REAL answer — it stores
// an explicit off — which is what keeps this from being a launch-time nag;
// Settings → Privacy and security is where it changes afterwards. Installs that
// predate the toggle are grandfathered, read as answered, and never see this.
//
// A sheet rather than an `Alert`: DESIGN.md §6 keeps `Alert` for destructive
// confirms, and this is a two-option question with copy that is the point.
// Dismissing it (backdrop, handle, back gesture) is "no consent" and stores the
// off, because a consent request that is walked away from has been declined.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  needsCrashReportChoice,
  setCrashReportsEnabled,
} from "../sentry/crashReportPreference";
import { initSentry } from "../sentry/initSentry";
import { fontSize, lineHeight, spacing, theme } from "../theme";
import { BottomSheet, Button } from "../ui";

export function CrashReportConsent() {
  // Read once per mount: after either answer the preference is set, so a
  // remount (sign-out and back in) finds it answered and never asks again.
  const [asking, setAsking] = useState(needsCrashReportChoice);

  const answer = (enabled: boolean) => {
    // A device that can't store the preference will be asked again next launch.
    // That is the honest outcome — the alternative is claiming a consent record
    // that does not exist — and it is bounded by the prefs DB being broken.
    setCrashReportsEnabled(enabled);
    // `initSentry` no-oped at startup because the question was unanswered, so
    // this is its FIRST call, not a second init.
    if (enabled) initSentry();
    setAsking(false);
  };

  return (
    <BottomSheet
      visible={asking}
      onClose={() => answer(false)}
      title="Send crash reports?"
      footer={
        <View style={styles.actions}>
          <Button label="Send crash reports" onPress={() => answer(true)} />
          <Button label="Not now" variant="ghost" onPress={() => answer(false)} />
        </View>
      }
    >
      <Text style={styles.body}>
        If Logjam crashes, we get the technical details. Reports are anonymous
        and stripped of canyon names and coordinates.
      </Text>
      <Text style={styles.body}>
        Off by default. Change it any time in Settings › Privacy and security.
      </Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: fontSize.sm,
    color: theme.textMuted,
    lineHeight: lineHeight.body,
    marginBottom: spacing(1.5),
  },
  actions: { gap: spacing(0.5) },
});
