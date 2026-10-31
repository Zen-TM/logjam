// Blocking re-consent screen — Agree or Sign out only (mirrors Logjam Web
// ConsentGate). Shown when needsReconsent() is true for the fetched current
// user; the server rejects any consentVersion other than the one it named.
//
// A brand-new account (no consent recorded) lands here too: the provider's
// sign-up page cannot ask for a username, the terms or an age, so it is
// welcomed rather than told the terms changed, and answers all three here, in
// the one request that records its consent.
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { SignOutHandler } from "../offline/signOutConfirm";
import { updateConsent } from "../api/queries";
import {
  PRIVACY_POLICY_URL,
  TERMS_URL,
  openLegalDocument,
} from "../legalLinks";
import { spacing, makeStyles } from "../theme";
import { Button, ErrorBanner, SwitchRow, TextField, TextLink } from "../ui";
import { consentFormProblem, consentSubmitFailure } from "./consentForm";

export function ConsentGate({
  consentVersion,
  newAccount,
  currentUsername,
  onConsented,
  onSignOut,
}: {
  /** The version the server named, which is the only one it will record. */
  consentVersion: string;
  /** No consent is recorded yet: the first sign-in of an account. */
  newAccount: boolean;
  /** The neutral name the API gave the account, offered as the default. */
  currentUsername: string;
  onConsented: () => void;
  onSignOut: SignOutHandler;
}) {
  const styles = useStyles();

  const [agreed, setAgreed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [username, setUsername] = useState(currentUsername);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Retry is offered only for a failed request; a missing tick is fixed by
  // ticking it.
  const [banner, setBanner] = useState<{
    message: string;
    retry: boolean;
  } | null>(null);
  // No nav header on the gates, so the status-bar/camera inset is ours to clear.
  const insets = useSafeAreaInsets();

  const agree = async () => {
    const problem = consentFormProblem({
      newAccount,
      username,
      agreed,
      ageConfirmed,
    });
    if (problem?.field === "username") {
      setUsernameError(problem.message);
      return;
    }
    if (problem) {
      setBanner(problem);
      return;
    }
    setSubmitting(true);
    setBanner(null);
    setUsernameError(null);
    try {
      await (newAccount
        ? updateConsent(consentVersion, username.trim())
        : updateConsent(consentVersion));
      onConsented();
    } catch (err) {
      console.error(err);
      const failure = consentSubmitFailure(err, newAccount);
      if (failure.field === "username") setUsernameError(failure.message);
      else setBanner(failure);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing(3),
          paddingBottom: insets.bottom + spacing(3),
        },
      ]}
    >
      <Text style={styles.title}>
        {newAccount ? "Welcome to Logjam" : "Terms & privacy"}
      </Text>
      <Text style={styles.body}>
        {newAccount
          ? "Choose the name friends see when you share a place with them, and review the terms to finish creating your account."
          : `Logjam's Terms of Use and Privacy Policy have changed (last updated ${consentVersion}). Please review them and confirm your agreement to keep using Logjam.`}
      </Text>
      {newAccount ? (
        <TextField
          label="Username"
          value={username}
          onChangeText={(text) => {
            setUsername(text);
            setUsernameError(null);
            setBanner(null);
          }}
          error={usernameError}
          hint="What friends see when you share a place with them."
          autoCapitalize="none"
          autoComplete="username"
          editable={!submitting}
        />
      ) : null}
      <TextLink
        label="Read the Terms of Use"
        onPress={() => openLegalDocument(TERMS_URL)}
      />
      <TextLink
        label="Read the Privacy Policy"
        onPress={() => openLegalDocument(PRIVACY_POLICY_URL)}
      />
      <SwitchRow
        title="I agree to the terms"
        description="Terms and Privacy Policy"
        checked={agreed}
        onChange={(next) => {
          setAgreed(next);
          setBanner(null);
        }}
      />
      {newAccount ? (
        <SwitchRow
          title="I am 18 or older"
          checked={ageConfirmed}
          onChange={(next) => {
            setAgeConfirmed(next);
            setBanner(null);
          }}
        />
      ) : null}
      {banner ? (
        <ErrorBanner
          message={banner.message}
          onRetry={banner.retry ? agree : undefined}
        />
      ) : null}
      <Button label="Agree and continue" onPress={agree} loading={submitting} />
      <Button label="Sign out" variant="ghost" onPress={() => onSignOut()} />
    </ScrollView>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  root: { flex: 1, backgroundColor: theme.page },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing(3),
    gap: spacing(2),
  },
  title: { ...textRole.title, color: theme.text },
  body: {
    ...textRole.paragraph,
    color: theme.text,
  },
}));
