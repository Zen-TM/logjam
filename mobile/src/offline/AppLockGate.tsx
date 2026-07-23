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
import { useGeoPdfImports } from "../geopdf/useGeoPdfImports";
import { useVectorImports } from "../imports/useVectorImports";
import { fontSize, spacing, theme } from "../theme";
import { useMapArtifacts } from "./useMapArtifacts";

// The system auth sheet runs in its own activity: launching and dismissing it
// fires background/active AppState churn on the host activity. Any relock
// logic keyed on AppState must ignore transitions caused by the prompt itself
// (during, and for a grace window after), or unlock→pause→relock→prompt loops
// forever — each cycle remounting the whole app (observed: ~2.5 Hz).
const POST_UNLOCK_GRACE_MS = 2500;

// A prompt older than this is treated as hung (authenticateAsync can stall
// when fired during activity transitions) — a manual retry cancels it and
// starts fresh instead of being swallowed by the in-flight guard.
const PROMPT_STALE_MS = 12_000;

// Dev-only escape hatch: every dev-client reload re-arms the lock, which
// makes emulator/device debug loops painful. Inert in release builds.
const DEV_LOCK_DISABLED =
  __DEV__ && process.env.EXPO_PUBLIC_DISABLE_APP_LOCK === "1";

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { artifacts, loaded: artifactsLoaded } = useMapArtifacts();
  // Imported tracks are the user's own canyon-area coordinates — they arm
  // the lock exactly like downloaded map data. GeoPDF imports arm it from
  // the ROW (the source.pdf lands on disk before any map_artifact exists).
  const { imports, loaded: importsLoaded } = useVectorImports();
  const { geoPdfImports, loaded: geoPdfLoaded } = useGeoPdfImports();
  const loaded = artifactsLoaded && importsLoaded && geoPdfLoaded;
  const lockRequired =
    !DEV_LOCK_DISABLED &&
    (artifacts.length > 0 || imports.length > 0 || geoPdfImports.length > 0);
  const [unlocked, setUnlocked] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const prompting = useRef(false);
  const promptStartedAt = useRef(0);
  const lastUnlockAt = useRef(0);
  const autoPrompted = useRef(false);
  const sessionBeganWithoutLock = useRef(false);

  // When the FIRST offline artifact lands mid-session (user just tapped
  // download), arming the lock must not slam the gate on the live session —
  // treat the session as unlocked and gate from the next background instead.
  // A cold start with existing artifacts never takes this path: its first
  // completed registry read arrives WITH rows, so the
  // "loaded-and-empty" flag below was never set.
  useEffect(() => {
    if (loaded && !lockRequired) sessionBeganWithoutLock.current = true;
    if (lockRequired && sessionBeganWithoutLock.current) {
      sessionBeganWithoutLock.current = false;
      lastUnlockAt.current = Date.now();
      // Also consume this lock's auto-prompt: the prompt effect below runs in
      // the SAME commit and still sees unlocked=false (state lands next
      // render) — without this it fires the biometric sheet mid-import
      // (observed on the Pixel). The background relock resets the flag, so
      // the next genuine lock still auto-prompts.
      autoPrompted.current = true;
      setUnlocked(true);
    }
  }, [loaded, lockRequired]);

  const prompt = useCallback(async () => {
    const now = Date.now();
    if (prompting.current) {
      if (now - promptStartedAt.current < PROMPT_STALE_MS) return;
      // Hung prompt: cancel the native side so a fresh attempt can start.
      await LocalAuthentication.cancelAuthenticate().catch(() => {});
    }
    prompting.current = true;
    promptStartedAt.current = now;
    setAuthFailed(false);
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
      } else {
        // Cancelled / failed / lockout: stay locked, tell the user the
        // button works (never fail silently).
        setAuthFailed(true);
      }
    } catch (err) {
      // Fail closed: stay locked, the retry button remains.
      console.error(err);
      setAuthFailed(true);
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
      {authFailed ? (
        <Text style={styles.line}>Authentication didn&apos;t complete — try again.</Text>
      ) : null}
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
