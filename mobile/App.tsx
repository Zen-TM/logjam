import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { CLIENT_VERSION } from "./src/config";
import { useMinVersionGate } from "./src/useMinVersionGate";
import { useAuth } from "./src/auth/useAuth";
import { AuthFlow } from "./src/screens/AuthFlow";
import { AppShell } from "./src/AppShell";
import { LoadingState } from "./src/ui/ScreenStates";
import { fontSize, spacing, theme } from "./src/theme";

export default function App() {
  const minVersionGate = useMinVersionGate();
  const auth = useAuth();

  if (minVersionGate.status === "upgradeRequired") {
    return (
      <SafeAreaProvider>
        <View style={styles.blockingContainer}>
          <StatusBar style="light" />
          <Text style={styles.blockingTitle}>Update required</Text>
          <Text style={styles.blockingLine}>
            This version ({CLIENT_VERSION}) is no longer supported. Minimum
            supported version is {minVersionGate.minVersion}. Please update the
            app to continue.
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {auth.state === "loading" ? (
        <LoadingState />
      ) : auth.state === "authenticated" ? (
        <AppShell onSignOut={auth.signOut} />
      ) : (
        <SafeAreaView style={styles.authSafeArea}>
          <AuthFlow auth={auth} />
        </SafeAreaView>
      )}
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
