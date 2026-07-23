// App lock (Stage 4 mandate): once offline map data exists on the device,
// the UI locks behind the device's biometric/credential auth on cold start
// and whenever the app returns from background. Uses the OS authenticator
// (biometric with PIN/pattern fallback) — no app-managed secret.
//
// A device with NO enrolled security (no biometrics, no passcode) has nothing
// to gate with; the gate passes through rather than bricking the app — the
// data is exactly as protected as everything else on an unlocked device.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";

import { Button } from "../ui/Button";
import { fontSize, spacing, theme } from "../theme";
import { useMapArtifacts } from "./useMapArtifacts";

// The system auth sheet runs in its own activity: launching and dismissing it
// fires background/active AppState churn on the host activity. Any relock
// logic keyed on AppState must ignore transitions caused by the prompt itself
// (during, and for a grace window after), or unlock→pause→relock→prompt loops
// forever — each cycle remounting the whole app (observed: ~2.5 Hz).
const POST_UNLOCK_GRACE_MS = 2500;

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const artifacts = useMapArtifacts();
  const lockRequired = artifacts.length > 0;
  const [unlocked, setUnlocked] = useState(false);
  const prompting = useRef(false);
  const lastUnlockAt = useRef(0);
  const autoPrompted = useRef(false);

  const prompt = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) {
        // Nothing enrolled on the device — see header comment.
        lastUnlockAt.current = Date.now();
        setUnlocked(true);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Logjam",
      });
      if (result.success) {
        lastUnlockAt.current = Date.now();
        setUnlocked(true);
      } else if (
        result.error === "not_enrolled" ||
        result.error === "not_available"
      ) {
        // Enrolled-level probe said "something", the authenticator says
        // there's nothing usable — treat as no device security (emulators).
        lastUnlockAt.current = Date.now();
        setUnlocked(true);
      }
    } catch (err) {
      // Fail closed: stay locked, the retry button remains.
      console.error(err);
    } finally {
      prompting.current = false;
    }
  }, []);

  // Re-lock when the app genuinely goes to background — not on the auth
  // sheet's own activity transitions (see POST_UNLOCK_GRACE_MS note).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (
        state === "background" &&
        !prompting.current &&
        Date.now() - lastUnlockAt.current > POST_UNLOCK_GRACE_MS
      ) {
        autoPrompted.current = false;
        setUnlocked(false);
      }
    });
    return () => sub.remove();
  }, []);

  // Auto-prompt ONCE per lock; further attempts go through the button. An
  // unconditional retry here is what looped when the authenticator fails
  // instantly.
  useEffect(() => {
    if (lockRequired && !unlocked && !autoPrompted.current) {
      autoPrompted.current = true;
      prompt();
    }
  }, [lockRequired, unlocked, prompt]);

  if (!lockRequired || unlocked) return <>{children}</>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Locked</Text>
      <Text style={styles.line}>
        Offline maps are stored on this device. Unlock to continue.
      </Text>
      <Button label="Unlock" onPress={prompt} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(2),
    padding: spacing(3),
    backgroundColor: theme.primary,
  },
  title: { fontSize: fontSize.xl, fontWeight: "600", color: theme.textPrimary },
  line: {
    fontSize: fontSize.sm,
    color: theme.textMuted,
    textAlign: "center",
  },
});
