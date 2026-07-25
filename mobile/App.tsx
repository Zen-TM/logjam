import { Alert, StyleSheet, Text } from "react-native";
// SystemBars (react-native-edge-to-edge) rather than expo-status-bar: with
// android.edgeToEdgeEnabled the app draws behind BOTH system bars, so the
// navigation bar needs light icons too — expo-status-bar only styles the status
// bar, which left the gesture area a black strip below the tab bar.
import { SystemBars } from "react-native-edge-to-edge";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { CLIENT_VERSION } from "./src/config";
import { useMinVersionGate } from "./src/useMinVersionGate";
import { useAuth } from "./src/auth/useAuth";
import { countUnsyncedChanges, wipeAllSyncData } from "./src/sync/syncDb";
import { unregisterPushNotifications } from "./src/notifications/pushRegistration";
import { AuthFlow } from "./src/screens/AuthFlow";
import { AppShell } from "./src/AppShell";
import { AppLockGate } from "./src/offline/AppLockGate";
import { LoadingState } from "./src/ui/ScreenStates";
import { fontSize, spacing, theme } from "./src/theme";

export default function App() {
  const minVersionGate = useMinVersionGate();
  const auth = useAuth();

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
      ) : auth.state === "authenticated" ? (
        <AppShell
          onSignOut={async () => {
            // Sign-out wipes the sync mirror AND the outbox (stage8 §9) —
            // unflushed local changes die with it, so block on a
            // confirmation when any exist.
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
            await wipeAllSyncData();
            await auth.signOut();
          }}
        />
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
