import { useEffect } from "react";
import { Alert, Linking, Platform, StyleSheet, Text } from "react-native";
import Constants from "expo-constants";
// SystemBars (react-native-edge-to-edge) rather than expo-status-bar: with
// android.edgeToEdgeEnabled the app draws behind BOTH system bars, so the
// navigation bar needs light icons too — expo-status-bar only styles the status
// bar, which left the gesture area a black strip below the tab bar.
import { SystemBars } from "react-native-edge-to-edge";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { CLIENT_VERSION } from "./src/config";
import { useMinVersionGate } from "./src/useMinVersionGate";
import { mountsAppShell, useAuth } from "./src/auth/useAuth";
import { countUnsyncedChanges } from "./src/sync/syncDb";
import { wipeAllLocalData } from "./src/offline/wipeLocalData";
import { unregisterPushNotifications } from "./src/notifications/pushRegistration";
import { AuthFlow } from "./src/screens/AuthFlow";
import { LandingScreen } from "./src/screens/LandingScreen";
import { CrashReportConsent } from "./src/screens/CrashReportConsent";
import { AppShell } from "./src/AppShell";
import { AppLockGate } from "./src/offline/AppLockGate";
import { applyScreenCapturePolicy } from "./src/offline/appLockPreference";
import { excludeLocalDataFromBackup } from "./src/offline/localStores";
import { LoadingState } from "./src/ui/ScreenStates";
import { Button } from "./src/ui/Button";
import { fontSize, spacing, theme } from "./src/theme";

// The blocked build's only way out. Derived from app.json's `android.package`
// rather than a second literal, so it cannot drift from the id the store
// actually lists. The https form (not `market://`) because it still resolves
// when the Play app is missing — a sideloaded field build is exactly the case
// this screen exists for. Android only: there is no iOS listing to point at
// yet, and the text alone has to do until there is.
const storeUrl =
  Platform.OS === "android" && Constants.expoConfig?.android?.package
    ? `https://play.google.com/store/apps/details?id=${Constants.expoConfig.android.package}`
    : null;

export default function App() {
  const minVersionGate = useMinVersionGate();
  const auth = useAuth();

  // Two process-scoped privacy settings that have to be re-applied on every
  // launch because neither survives one: FLAG_SECURE (follows the app-lock
  // preference — see applyScreenCapturePolicy) and the iOS backup exclusion
  // on the documents tree (a no-op on Android, which has allowBackup=false).
  useEffect(() => {
    void applyScreenCapturePolicy().catch(console.error);
    void excludeLocalDataFromBackup().catch(console.error);
  }, []);

  if (minVersionGate.status === "upgradeRequired") {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.blockingContainer}>
          <SystemBars style="light" />
          <Text style={styles.blockingTitle}>Update required</Text>
          <Text style={styles.blockingLine}>
            This version ({CLIENT_VERSION}) is no longer supported. Minimum
            supported version is {minVersionGate.minVersion}. Please update the
            app to continue.
          </Text>
          {storeUrl ? (
            <Button
              label="Open the Play Store"
              icon="external-link"
              onPress={() => {
                void Linking.openURL(storeUrl).catch(console.error);
              }}
            />
          ) : null}
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SystemBars style="light" />
      {/* App lock (Stage 4): active once offline map data exists on-device. */}
      <AppLockGate>
      {auth.state === "loading" ? (
        <LoadingState />
      ) : mountsAppShell(auth.state) ? (
        <>
        {/* Asked once, on the first arrival INTO the app — guest or signed in.
            It sits beside the shell rather than inside it so the question is
            not owned by any one screen. */}
        <CrashReportConsent />
        <AppShell
          accountState={auth.accountState}
          onLinkAccount={auth.linkAccount}
          onSignOut={async () => {
            // Sign-out wipes the sync mirror AND the outbox (stage8 §9), plus
            // the offline registry and every downloaded file — unflushed local
            // changes die with it, so block on a confirmation when any exist.
            const unsynced = await countUnsyncedChanges();
            if (unsynced > 0) {
              const confirmed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                  "Unsynced changes",
                  `You have ${unsynced} unsynced change${unsynced === 1 ? "" : "s"} that will be lost. Sign out anyway?`,
                  [
                    { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                    { text: "Sign out", style: "destructive", onPress: () => resolve(true) },
                  ],
                  { cancelable: true, onDismiss: () => resolve(false) },
                );
              });
              if (!confirmed) return;
            }
            // Unregister the push token BEFORE tokens are cleared (the DELETE
            // needs an authenticated request); best-effort inside.
            await unregisterPushNotifications();
            const wiped = await wipeAllLocalData();
            if (wiped.failed.length > 0) {
              // The privacy line held only partly. Say so — the next person to
              // use this phone would otherwise inherit the remains silently.
              Alert.alert(
                "Some data couldn't be removed",
                `This phone kept your ${wiped.failed.join(" and ")}. Signing out anyway; clear the app's storage in Android settings to be sure.`,
              );
            }
            await auth.signOut();
          }}
        />
        </>
      ) : auth.state === "chooser" || auth.state === "signIn" ? (
        // One screen for both: the landing screen IS the sign-in screen, and
        // the only thing the two states change is whether "continue without an
        // account" is on offer.
        <SafeAreaView style={styles.authSafeArea}>
          <LandingScreen auth={auth} />
        </SafeAreaView>
      ) : (
        <SafeAreaView style={styles.authSafeArea}>
          <AuthFlow auth={auth} />
        </SafeAreaView>
      )}
      </AppLockGate>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  blockingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing(3),
    gap: spacing(1),
    backgroundColor: theme.primary,
  },
  blockingTitle: { fontSize: fontSize.xl, fontWeight: "600", color: theme.textPrimary },
  blockingLine: {
    fontSize: fontSize.sm,
    color: theme.textMuted,
    textAlign: "center",
  },
  authSafeArea: { flex: 1, backgroundColor: theme.primary },
});
