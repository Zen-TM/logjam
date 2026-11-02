// Logjam GPS's own sign in, sign up, email code and password reset, on the
// landing screen under a Cognito issuer (ADR 0045). The state sits in one
// component because the screens hand values to each other: the password typed
// to sign up is what signs the account in once its email code is accepted.
//
// A password lives in this component's state only. It is cleared the moment it
// has been sent, and is never stored or logged (Guard: auth/passwordPrivacy.test.ts).
// Anything the forms cannot finish opens the provider's page (useAuth).
import { useState } from "react";
import { Text, View } from "react-native";
import {
  isValidEmailFormat,
  isValidPassword,
  messageFromError,
  PASSWORD_HINT,
  signUpFormProblem,
  USERNAME_HINT,
  USERNAME_TAKEN,
} from "@logjam/shared";

import { accountCalls } from "../auth/oidcSession";
import type { useAuth } from "../auth/useAuth";
import { isUsernameFree } from "../api/queries";
import { makeStyles, spacing } from "../theme";
import {
  Button,
  ErrorBanner,
  FormStack,
  SwitchRow,
  TextField,
  TextLink,
} from "../ui";
import { TermsSwitch } from "./TermsSwitch";

type Auth = ReturnType<typeof useAuth>;
type Screen =
  | "signIn"
  | "signUp"
  | "confirmSignUp"
  | "forgotPassword"
  | "confirmForgotPassword";

const EMAIL_PROPS = {
  autoCapitalize: "none",
  autoCorrect: false,
  autoComplete: "email",
  keyboardType: "email-address",
  textContentType: "emailAddress",
} as const;

export function AccountForms({
  auth,
  offersGuest,
  onExplainGuest,
}: {
  auth: Auth;
  offersGuest: boolean;
  onExplainGuest: () => void;
}) {
  const styles = useStyles();
  const [screen, setScreen] = useState<Screen>("signIn");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  // Set only once the sign-up form, ticks and all, has been accepted: it is what
  // records consent at first sign-in, so whatever is typed in the field is not.
  const [signedUpUsername, setSignedUpUsername] = useState<string>();
  const [agreed, setAgreed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // `auth.error` is about signing in, and goes stale on the other screens.
  const shownError = error ?? (screen === "signIn" ? auth.error : null);

  const clearPasswords = () => {
    setPassword("");
    setConfirmPassword("");
  };

  const goTo = (next: Screen) => {
    setError(null);
    setEmailError(null);
    setUsernameError(null);
    setCode("");
    // Only the sign-up's email code needs the password that was just typed.
    if (next !== "confirmSignUp") clearPasswords();
    setNotice(null);
    setScreen(next);
  };

  /** Runs one submit: busy while it runs, and a thrown failure becomes the form's error. */
  const submit = async (fallback: string, work: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await work();
    } catch (err) {
      console.error(err instanceof Error ? err.name : typeof err);
      setError(messageFromError(err, fallback));
    }
    setSubmitting(false);
  };

  const sendCode = (to: string) =>
    accountCalls.resendSignUpCode(to).then(
      () => setNotice("We sent a new code."),
      (err: unknown) =>
        setError(messageFromError(err, "Couldn't send a code. Try again.")),
    );

  const signInWith = async (newAccountUsername?: string) => {
    let codeNeeded = false;
    try {
      const result = await auth.signInWithPassword(
        email.trim(),
        password,
        newAccountUsername,
      );
      if (result.type === "done") return;
      if (result.unconfirmed) {
        // Signed up, never entered the code: send one and ask for it here. The
        // password stays until the code is accepted, which signs them in.
        codeNeeded = true;
        setSignedUpUsername(undefined);
        goTo("confirmSignUp");
        await sendCode(email.trim());
      } else {
        goTo("signIn");
        setError(result.message);
      }
    } finally {
      // Sent, so gone, whichever way it went.
      if (!codeNeeded) clearPasswords();
    }
  };

  const onSignIn = () => {
    if (!isValidEmailFormat(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    if (!password) {
      setError("Enter your password.");
      return;
    }
    return submit("Couldn't sign in. Try again.", () => signInWith());
  };

  const onSignUp = () => {
    const problem = signUpFormProblem({
      name,
      email,
      username,
      password,
      confirmPassword,
      agreed,
      ageConfirmed,
    });
    setEmailError(problem?.field === "email" ? problem.message : null);
    setUsernameError(problem?.field === "username" ? problem.message : null);
    setError(problem?.field === "form" ? problem.message : null);
    if (problem) return;
    return submit("Couldn't sign up. Try again.", async () => {
      if (!(await isUsernameFree(username.trim()))) {
        setUsernameError(USERNAME_TAKEN);
        return;
      }
      await accountCalls.signUp({
        email: email.trim(),
        password,
        name: name.trim(),
      });
      setSignedUpUsername(username.trim());
      goTo("confirmSignUp");
    });
  };

  const onConfirmSignUp = () =>
    submit("Couldn't confirm your code. Try again.", async () => {
      await accountCalls.confirmSignUp(email.trim(), code.trim());
      // The password is held from the form that led here, so the just-verified
      // account signs in without asking again.
      await signInWith(signedUpUsername);
    });

  const onForgot = () => {
    if (!isValidEmailFormat(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    return submit("Couldn't send a reset code. Try again.", async () => {
      await accountCalls.forgotPassword(email.trim());
      goTo("confirmForgotPassword");
    });
  };

  const onConfirmForgot = () => {
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!isValidPassword(password)) {
      setError(
        "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol",
      );
      return;
    }
    return submit("Couldn't reset the password. Try again.", async () => {
      await accountCalls.confirmForgotPassword(
        email.trim(),
        code.trim(),
        password,
      );
      clearPasswords();
      goTo("signIn");
      setNotice("Password reset. Sign in with the new one.");
    });
  };

  const emailField = () => (
    <TextField
      label="Email"
      value={email}
      onChangeText={(text) => {
        setEmail(text);
        setEmailError(null);
      }}
      error={emailError}
      editable={!submitting}
      {...EMAIL_PROPS}
    />
  );

  const passwordFields = (label: string) => (
    <>
      <TextField
        label={label}
        value={password}
        onChangeText={setPassword}
        hint={PASSWORD_HINT}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!submitting}
      />
      <TextField
        label="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!submitting}
      />
    </>
  );

  const codeField = (label: string) => (
    <TextField
      label={label}
      value={code}
      onChangeText={setCode}
      keyboardType="number-pad"
      autoComplete="off"
      textContentType="oneTimeCode"
      editable={!submitting}
    />
  );

  // Directly above the submit it belongs to (shared/DESIGN.md §11).
  const banner = shownError ? <ErrorBanner message={shownError} /> : null;
  const noticeText = notice ? (
    <Text style={styles.notice}>{notice}</Text>
  ) : null;

  if (screen === "confirmSignUp") {
    return (
      <FormStack>
        <Text style={styles.heading}>Check your email</Text>
        <Text style={styles.body}>
          We sent a code to {email.trim()}. Check your spam folder too.
        </Text>
        {codeField("Verification code")}
        {noticeText}
        {banner}
        <Button label="Verify" onPress={onConfirmSignUp} loading={submitting} />
        <View style={styles.secondary}>
          <Button
            label="Send a new code"
            variant="ghost"
            onPress={() =>
              submit("Couldn't send a code. Try again.", () =>
                sendCode(email.trim()),
              )
            }
          />
          <Button
            label="Back to sign in"
            variant="ghost"
            onPress={() => goTo("signIn")}
          />
        </View>
      </FormStack>
    );
  }

  if (screen === "forgotPassword") {
    return (
      <FormStack>
        <Text style={styles.heading}>Reset your password</Text>
        <Text style={styles.body}>We will email you a code.</Text>
        {emailField()}
        {banner}
        <Button
          label="Send reset code"
          onPress={onForgot}
          loading={submitting}
        />
        <Button
          label="Back to sign in"
          variant="ghost"
          onPress={() => goTo("signIn")}
        />
      </FormStack>
    );
  }

  if (screen === "confirmForgotPassword") {
    return (
      <FormStack>
        <Text style={styles.heading}>Choose a new password</Text>
        <Text style={styles.body}>We sent a code to {email.trim()}.</Text>
        {codeField("Reset code")}
        {passwordFields("New password")}
        {banner}
        <Button
          label="Reset password"
          onPress={onConfirmForgot}
          loading={submitting}
        />
        <Button
          label="Back to sign in"
          variant="ghost"
          onPress={() => goTo("signIn")}
        />
      </FormStack>
    );
  }

  if (screen === "signUp") {
    return (
      <FormStack>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
          editable={!submitting}
        />
        {emailField()}
        <TextField
          label="Username"
          value={username}
          onChangeText={(text) => {
            setUsername(text);
            setUsernameError(null);
          }}
          error={usernameError}
          hint={USERNAME_HINT}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          textContentType="username"
          editable={!submitting}
        />
        {passwordFields("Password")}
        <TermsSwitch checked={agreed} onChange={setAgreed} />
        <SwitchRow
          title="I am 18 or older"
          checked={ageConfirmed}
          onChange={setAgeConfirmed}
        />
        {banner}
        <Button
          label="Create account"
          onPress={onSignUp}
          loading={submitting}
        />
        <Button
          label="Have an account? Sign in"
          variant="ghost"
          onPress={() => goTo("signIn")}
        />
      </FormStack>
    );
  }

  return (
    <FormStack>
      {emailField()}
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={onSignIn}
        editable={!submitting}
      />
      {noticeText}
      {banner}
      <Button label="Sign in" onPress={onSignIn} loading={submitting} />
      <TextLink
        label="Forgot password?"
        onPress={() => goTo("forgotPassword")}
      />

      {/* Everything below is deliberately quieter than Sign in. */}
      <View style={styles.secondary}>
        <Button
          label="Create an account"
          variant="outlineAccent"
          onPress={() => goTo("signUp")}
        />
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
    </FormStack>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  heading: { ...textRole.heading, color: theme.text },
  body: { ...textRole.paragraph, color: theme.text },
  notice: { ...textRole.detail, color: theme.text },
  secondary: { gap: spacing(0.5) },
}));
