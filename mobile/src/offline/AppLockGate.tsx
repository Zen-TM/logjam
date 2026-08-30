// App lock: when the user has turned it on, the UI locks behind the device's
// biometric/credential auth on cold start and whenever the app returns from
// background. Uses the OS authenticator (biometric with PIN/pattern fallback) —
// no app-managed secret.
//
// The lock is UNCONDITIONAL on the preference. It used to arm only once
// downloaded map data existed, on the theory that an empty device had nothing
// worth gating — which was never true: the sync mirror holds canyon names and
// coordinates from the first sync after sign-in, and trips, notes and photos
// with them. "Nothing downloaded" is not "nothing sensitive", so the data hooks
// that used to decide this are gone rather than reworded.
//
// The preference itself now defaults to OFF (appLockPreference.ts has the
// operator's reasoning) — so this gate is inert until someone asks for it.
//
// A device with NO enrolled security (no biometrics, no passcode) has nothing
// to gate with; the gate passes through rather than bricking the app — the
// data is exactly as protected as everything else on an unlocked device.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as LocalAuthentication from "expo-local-authentication";

import { Button } from "../ui";
import { isAppLockEnabled, onAppLockPreferenceChanged } from "./appLockPreference";
import { fontSize, fontWeight, spacing, theme } from "../theme";

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
  // The user's own switch (Settings → This phone) is the whole condition. Read
  // synchronously so the gate's very first render already knows — an async read
  // would flash the lock screen at someone who has it off. Turning it OFF costs
  // a biometric; see appLockPreference.ts.
  const [lockPreferred, setLockPreferred] = useState(isAppLockEnabled);
  useEffect(() => onAppLockPreferenceChanged(() => setLockPreferred(isAppLockEnabled())), []);

  const lockRequired = !DEV_LOCK_DISABLED && lockPreferred;
  const [unlocked, setUnlocked] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  // Whether the app is actually on screen. The auto-prompt below waits for it:
  // `authenticateAsync` needs a resumed activity to put BiometricPrompt on, and
  // fired without one it neither shows nor settles — it just hangs, holding the
  // in-flight guard so the Unlock button does nothing for the next 12 seconds.
  //
  // That is reachable ONLY while something keeps JS alive in the background,
  // which is exactly what track recording's foreground service does: going to
  // background relocks (below) and the prompt effect used to fire on the spot,
  // in the background, against no activity. The recording had to be killed from
  // Android to get back in. Prompt when we're on screen, not before.
  const [appActive, setAppActive] = useState(
    () => AppState.currentState === "active",
  );
  const prompting = useRef(false);
  const promptStartedAt = useRef(0);
  const lastUnlockAt = useRef(0);
  const autoPrompted = useRef(false);

  // Turning the lock ON mid-session must not slam the gate on the session that
  // just asked for it — the user is in Settings, they know who they are. This
  // session is let through and the lock starts biting at the next background.
  //
  // It is STATE, decided at mount, and deliberately not an effect that reacts
  // to the switch. An effect runs after the commit that already swapped
  // `children` for the lock screen, and that unmount tears down the whole
  // navigation tree: flipping the switch in Settings bounced the user out to a
  // freshly-mounted Map tab before the effect let them back in. Seeded from the
  // preference so a cold start with the lock already on is gated normally.
  const [lockDeferred, setLockDeferred] = useState(() => !isAppLockEnabled());
  // Turning it back OFF re-arms the deferral, so switching off and on again
  // doesn't prompt mid-session either. Safe as an effect: with lockRequired
  // false nothing is gated in that commit anyway.
  useEffect(() => {
    if (!lockRequired) setLockDeferred(true);
  }, [lockRequired]);

  /** The gate is actually shut: asked for, not yet satisfied, not deferred. */
  const locked = lockRequired && !unlocked && !lockDeferred;

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
      setAppActive(state === "active");
      if (
        state === "background" &&
        !prompting.current &&
        Date.now() - lastUnlockAt.current > POST_UNLOCK_GRACE_MS
      ) {
        autoPrompted.current = false;
        // The deferral is spent: whatever let this session through, the app has
        // now left the screen, which is the moment the lock exists for.
        setLockDeferred(false);
        setUnlocked(false);
      }
    });
    return () => sub.remove();
  }, []);

  // Auto-prompt ONCE per lock; further attempts go through the button. An
  // unconditional retry here is what looped when the authenticator fails
  // instantly.
  useEffect(() => {
    if (appActive && locked && !autoPrompted.current) {
      autoPrompted.current = true;
      prompt();
    }
  }, [appActive, locked, prompt]);

  if (!locked) return <>{children}</>;

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Locked</Text>
      {authFailed ? (
        <Text style={styles.line}>Authentication didn&apos;t complete — try again.</Text>
      ) : null}
      <Button label="Unlock" onPress={prompt} />
    </SafeAreaView>
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
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: theme.textPrimary },
  line: {
    fontSize: fontSize.sm,
    color: theme.textMuted,
    textAlign: "center",
  },
});
