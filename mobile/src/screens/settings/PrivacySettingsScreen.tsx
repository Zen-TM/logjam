// Settings → Privacy and security: what guards this phone's copy of the data,
// and what leaves it.
//
// Both switches are device-scoped and both work as a guest with no signal. The
// asymmetry on the app lock is the load-bearing part: turning it OFF goes
// through the device authenticator and a cancelled prompt springs the switch
// back on (DESIGN.md §7, `appLockPreference.ts`, fail-closed). Without that,
// the switch is a one-tap bypass of the thing it controls.
//
// The closing section is not a setting — it is an answer. "What of mine is on
// this device, and what protects it?" is a fair question to have about an
// offline app, and leaving it unanswered doesn't make the answer better. It
// states WHAT KINDS of data are held and names no canyon and no coordinate
// (§11).
import { useCallback, useState } from "react";
import { StyleSheet, Text } from "react-native";

import { isAppLockEnabled, setAppLockEnabled } from "../../offline/appLockPreference";
import {
  areCrashReportsEnabled,
  setCrashReportsEnabled,
} from "../../sentry/crashReportPreference";
import {
  savesCapturesToGallery,
  setSaveCapturesToGallery,
} from "../../media/galleryPreference";
import { fontSize, lineHeight, spacing, theme } from "../../theme";
import { ScreenScroll, SectionHeader, Toast, type ToastMessage } from "../../ui";
import { PreferenceRow } from "./settingsKit";

export function PrivacySettingsScreen() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ text, tone, nonce: Date.now() });
  }, []);

  // Device-scoped and readable synchronously, so this row never renders in the
  // wrong position while a read resolves.
  const [appLockEnabled, setAppLockEnabledState] = useState(isAppLockEnabled);

  const toggleAppLock = useCallback(async () => {
    const next = !appLockEnabled;
    const outcome = await setAppLockEnabled(next);
    if (outcome.status === "changed") {
      setAppLockEnabledState(outcome.enabled);
      notify(outcome.enabled ? "App lock on." : "App lock off for this phone.");
      return;
    }
    // Cancelled or unreachable: the switch springs back, which is the truth.
    setAppLockEnabledState(isAppLockEnabled());
    if (outcome.status === "failed") notify(outcome.message, "error");
  }, [appLockEnabled, notify]);

  // The one place the entry chooser's crash-report question can be revisited
  // (the chooser says so).
  const [crashReports, setCrashReportsState] = useState(areCrashReportsEnabled);
  const toggleCrashReports = useCallback(() => {
    const next = !crashReports;
    if (!setCrashReportsEnabled(next)) {
      notify("This phone wouldn't store that setting.", "error");
      return;
    }
    setCrashReportsState(next);
  }, [crashReports, notify]);

  // Off by default — see galleryPreference.ts for why that default is a
  // privacy decision and not a taste one.
  const [saveToGallery, setSaveToGalleryState] = useState(savesCapturesToGallery);
  const toggleSaveToGallery = useCallback(() => {
    const next = !saveToGallery;
    if (!setSaveCapturesToGallery(next)) {
      notify("This phone wouldn't store that setting.", "error");
      return;
    }
    setSaveToGalleryState(next);
  }, [saveToGallery, notify]);

  return (
    <>
      <ScreenScroll>
        <SectionHeader label="This phone" />
        <PreferenceRow
          icon="lock"
          title="App lock"
          // No trailing pill beside the switch: the switch is already the
          // trailing element, and a pill next to it was what forced this
          // sentence to ellipsise.
          subtitle="Asks for your fingerprint or PIN each time Logjam opens."
          value={appLockEnabled}
          ready
          onToggle={() => void toggleAppLock()}
        />
        <PreferenceRow
          icon="alert-octagon"
          title="Send crash reports"
          // Names what is scrubbed, because "anonymous" alone is a claim the
          // user has no way to check and this app's whole premise is that
          // canyon locations don't leave it (scrubEvent.ts does the work).
          subtitle="Canyon names and coordinates are removed before sending. Takes effect next launch."
          value={crashReports}
          ready
          onToggle={toggleCrashReports}
        />

        <PreferenceRow
          icon="image"
          title="Save photos to your gallery"
          // Says the consequence, which is the part a switch label can't: the
          // copy is out of Logjam's storage, its backup exclusion and its lock,
          // and nothing here can take it back.
          subtitle="A copy of anything you shoot in Logjam goes to your camera roll, outside the app lock."
          subtitleNumberOfLines={3}
          value={saveToGallery}
          ready
          onToggle={toggleSaveToGallery}
        />

        <SectionHeader label="What's on this phone" />
        <Text style={styles.note}>
          {"Your canyons, trips, notes, photos and saved maps are stored on this " +
            "device and kept out of your phone's cloud backup. The app lock is " +
            "what protects them if someone else picks up your phone."}
        </Text>
      </ScreenScroll>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  note: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.body,
    marginBottom: spacing(2),
  },
});
