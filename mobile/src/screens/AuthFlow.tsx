// Unauthenticated flow: sign in / sign up / confirm code / forgot password.
// State machine lives in useAuth (port of web useAuth.ts); this renders the
// screen for the current AuthState. All Cognito errors arrive pre-mapped to
// user-friendly strings via messageFromError/mapAuthError — never raw.
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { useAuth } from "../auth/useAuth";
import { fontSize, fontWeight, spacing, theme } from "../theme";
import { Button, ErrorBanner, TextField } from "../ui";

type Auth = ReturnType<typeof useAuth>;

export function AuthFlow({ auth }: { auth: Auth }) {
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.appTitle}>Logjam</Text>
        {auth.error ? (
          <View style={styles.bannerSlot}>
            <ErrorBanner message={auth.error} />
          </View>
        ) : null}
        {auth.state === "signIn" && <SignInForm auth={auth} />}
        {auth.state === "signUp" && <SignUpForm auth={auth} />}
        {auth.state === "confirmSignUp" && <ConfirmSignUpForm auth={auth} />}
        {auth.state === "forgotPassword" && <ForgotPasswordForm auth={auth} />}
        {auth.state === "confirmForgotPassword" && <ConfirmForgotPasswordForm auth={auth} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SignInForm({ auth }: { auth: Auth }) {
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
      <Text style={styles.heading}>Sign in</Text>
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
      />
      <Button label="Sign in" onPress={submit} loading={submitting} />
      <FooterLink label="Forgot password?" onPress={auth.goToForgotPassword} />
      <FooterLink label="No account? Sign up" onPress={auth.goToSignUp} />
    </View>
  );
}

function SignUpForm({ auth }: { auth: Auth }) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    await auth.signUp(username.trim(), password, email.trim(), name.trim());
    setSubmitting(false);
  };

  return (
    <View style={styles.form}>
      <Text style={styles.heading}>Sign up</Text>
      <TextField label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
      <TextField label="Name" value={name} onChangeText={setName} autoComplete="name" />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
      />
      <Button label="Create account" onPress={submit} loading={submitting} />
      <FooterLink label="Have an account? Sign in" onPress={auth.goToSignIn} />
    </View>
  );
}

function ConfirmSignUpForm({ auth }: { auth: Auth }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    await auth.confirmSignUp(code.trim(), password);
    setSubmitting(false);
  };

  const resend = async () => {
    const result = await auth.resendSignUpCode();
    setResendMessage(result.ok ? "Code re-sent — check your email." : (result.error ?? null));
  };

  return (
    <View style={styles.form}>
      <Text style={styles.heading}>Confirm your email</Text>
      <Text style={styles.hint}>
        We sent a verification code to {auth.pendingUsername}.
      </Text>
      <TextField label="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />
      <Button label="Confirm and sign in" onPress={submit} loading={submitting} />
      <FooterLink label="Resend code" onPress={resend} />
      {resendMessage ? <Text style={styles.hint}>{resendMessage}</Text> : null}
    </View>
  );
}

function ForgotPasswordForm({ auth }: { auth: Auth }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    await auth.forgotPassword(email.trim());
    setSubmitting(false);
  };

  return (
    <View style={styles.form}>
      <Text style={styles.heading}>Reset password</Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <Button label="Send reset code" onPress={submit} loading={submitting} />
      <FooterLink label="Back to sign in" onPress={auth.goToSignIn} />
    </View>
  );
}

function ConfirmForgotPasswordForm({ auth }: { auth: Auth }) {
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    await auth.confirmForgotPassword(code.trim(), newPassword);
    setSubmitting(false);
  };

  return (
    <View style={styles.form}>
      <Text style={styles.heading}>Enter reset code</Text>
      <Text style={styles.hint}>
        We sent a reset code to {auth.pendingUsername}.
      </Text>
      <TextField label="Reset code" value={code} onChangeText={setCode} keyboardType="number-pad" />
      <TextField
        label="New password"
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
      />
      <Button label="Reset password" onPress={submit} loading={submitting} />
      <FooterLink label="Back to sign in" onPress={auth.goToSignIn} />
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
  appTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: theme.textPrimary,
    textAlign: "center",
    marginBottom: spacing(2),
  },
  bannerSlot: { marginBottom: spacing(1) },
  form: { gap: spacing(2) },
  heading: { fontSize: fontSize.lg, fontWeight: fontWeight.medium, color: theme.textPrimary },
  hint: { fontSize: fontSize.sm, color: theme.textMuted },
  footerLink: { alignSelf: "center", padding: spacing(1) },
  footerLinkText: { color: theme.accent, fontSize: fontSize.sm },
});
