// First thing a fresh install shows, and the sign-in screen for the rest of the
// app's life. One screen, two states: the sign-in form, and the explainer that
// stands between "continue without an account" and actually doing it.
//
// It renders for BOTH `chooser` and `signIn` — they were two screens with the
// sign-in form one tap behind a menu, and a second copy of the form in
// `AuthFlow`. The only difference left is which way out is offered: a fresh
// install can go on without an account, a guest linking one (or a rejected
// session) goes back to where they came from.
//
// Load-bearing rather than decorative:
//
//  1. **The storage warning.** Guest data is on this phone and nowhere else —
//     `allowBackup: false` (app.json) means not even Android's cloud backup
//     holds a copy, which is the correct privacy posture and also means a lost
//     phone is total loss. It is a STATE here, not a card below the fold: by
//     the time someone has a season of trips recorded it is too late to
//     mention, so "continue without an account" shows it and asks again.
//  2. Cognito errors arrive pre-mapped through `messageFromError`/
//     `mapAuthError` — never raw text in the banner.
//
// The crash-report question is NOT here any more: it is a one-time dialog shown
// once the user is inside the app (`CrashReportConsent`, mounted from App.tsx),
// for a guest and a signed-in user alike.
import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { useAuth } from "../auth/useAuth";
import { fontSize, fontWeight, lineHeight, radius, spacing, theme } from "../theme";
import { Button, ErrorBanner, TextField } from "../ui";

type Auth = ReturnType<typeof useAuth>;

export function LandingScreen({ auth }: { auth: Auth }) {
  // A guest LINKING an account is the only visitor with somewhere else to go,
  // so they get "Back"; everyone else can still go on without an account.
  // Not `auth.state === "chooser"`: this screen renders for `signIn` too, and
  // keying on the state showed a "Back" that went to the screen it was already
  // on (see useAuth.offersGuestEntry).
  const offersGuest = auth.offersGuestEntry;
  const [mode, setMode] = useState<"signIn" | "guestExplainer">("signIn");

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.mark}>
          <Image source={require("../../assets/logo.png")} style={styles.logo} accessibilityIgnoresInvertColors />
          <Text style={styles.appTitle}>Logjam</Text>
          <Text style={styles.tagline}>Your canyoning logbook and offline maps.</Text>
        </View>

        {auth.error ? <ErrorBanner message={auth.error} /> : null}

        {mode === "signIn" ? (
          <SignInPanel
            auth={auth}
            offersGuest={offersGuest}
            onExplainGuest={() => setMode("guestExplainer")}
          />
        ) : (
          <GuestExplainer
            onBack={() => setMode("signIn")}
            onCreateAccount={auth.goToSignUp}
            onContinue={auth.chooseGuest}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SignInPanel({
  auth,
  offersGuest,
  onExplainGuest,
}: {
  auth: Auth;
  offersGuest: boolean;
  onExplainGuest: () => void;
}) {
  const [email, setEmail] = useState(auth.pendingUsername);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    await auth.signIn(email.trim(), password);
    setSubmitting(false);
  };

  return (
    <View style={styles.form}>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Button label="Sign in" onPress={submit} loading={submitting} />
      <FooterLink label="Forgot password?" onPress={auth.goToForgotPassword} />

      {/* Everything below the rule is deliberately quieter than Sign in. */}
      <View style={styles.secondary}>
        <Button label="Create an account" variant="outlineAccent" onPress={auth.goToSignUp} />
        {offersGuest ? (
          <Button
            label="Continue without an account"
            variant="ghost"
            onPress={onExplainGuest}
          />
        ) : (
          <Button label="Back" variant="ghost" onPress={auth.backToChooser} />
        )}
      </View>
    </View>
  );
}

function GuestExplainer({
  onBack,
  onCreateAccount,
  onContinue,
}: {
  onBack: () => void;
  onCreateAccount: () => void;
  /** Returns false when the choice could not be stored (auth.error says why). */
  onContinue: () => boolean;
}) {
  return (
    <View style={styles.form}>
      <Text style={styles.heading}>Without an account</Text>
      <Text style={styles.body}>
        Everything you record stays on this phone and is never uploaded. It is
        not backed up anywhere — if you lose this phone, you lose it. Creating an
        account later keeps what you&apos;ve already recorded.
      </Text>
      <Text style={styles.body}>
        Sharing canyons with friends, LiDAR maps from your web account, and the
        detailed vector basemap download all need an account. Downloaded
        topographic and aerial maps work without one.
      </Text>
      <View style={styles.secondary}>
        <Button label="Continue anyway" variant="outlineAccent" onPress={onContinue} />
        <Button label="Create an account" variant="ghost" onPress={onCreateAccount} />
        <Button label="Back to login" variant="ghost" onPress={onBack} />
      </View>
    </View>
  );
}

function FooterLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={styles.footerLink}>
      <Text style={styles.footerLinkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing(3),
    gap: spacing(2),
  },
  mark: { alignItems: "center", gap: spacing(0.5) },
  // The app icon is a mark, not a wordmark: it carries its own dark ground, so
  // it needs the rounded-square crop the launcher gives it to stop reading as a
  // stray photo on the page.
  //
  // It is its OWN COPY of that file (assets/logo.png), not `assets/icon.png`,
  // and that is load-bearing rather than untidy: app.json claims icon.png as
  // the launcher icon, so the icon pipeline consumes it and expo-updates never
  // registers it in the embedded asset map. The drawable ships, the runtime
  // cannot resolve it, and the Image renders 88pt of nothing — which is
  // exactly what a release build did, silently, while debug was fine. Do not
  // "de-duplicate" these two files.
  logo: { width: 88, height: 88, borderRadius: radius.xl, marginBottom: spacing(1) },
  appTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: theme.textPrimary,
  },
  tagline: { fontSize: fontSize.sm, color: theme.textMuted, textAlign: "center" },
  form: { gap: spacing(2) },
  heading: { fontSize: fontSize.lg, fontWeight: fontWeight.medium, color: theme.textPrimary },
  body: { fontSize: fontSize.sm, color: theme.textMuted, lineHeight: lineHeight.body },
  secondary: { gap: spacing(0.5) },
  footerLink: { alignSelf: "center", padding: spacing(0.5) },
  footerLinkText: { color: theme.accent, fontSize: fontSize.sm },
});
