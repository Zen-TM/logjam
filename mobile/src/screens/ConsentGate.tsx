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
import {
  consentFormProblem,
  consentSubmitFailure,
  REGIONS,
  SIGN_IN_COPY,
  USERNAME_HINT,
  type Region,
} from "@logjam/shared";

import type { AccountState } from "../auth/capabilities";
import type { SignOutHandler } from "../offline/signOutConfirm";
import { updateConsent } from "../api/queries";
import { spacing, makeStyles } from "../theme";
import { Button, ErrorBanner, SwitchRow, TextField } from "../ui";
import { RegionStep } from "./RegionStep";
import { showsRegionStep } from "./regionChoice";
import { TermsSwitch } from "./TermsSwitch";

export function ConsentGate({
  consentVersion,
  newAccount,
  currentUsername,
  accountState,
  onConsented,
  onSignOut,
  regions = REGIONS,
}: {
  /** The version the server named, which is the only one it will record. */
  consentVersion: string;
  /** No consent is recorded yet: the first sign-in of an account. */
  newAccount: boolean;
  /** The neutral name the API gave the account, offered as the default. */
  currentUsername: string;
  accountState: AccountState;
  onConsented: () => void;
  onSignOut: SignOutHandler;
  /** Every region on offer; a prop so a test can give the step two. */
  regions?: readonly Region[];
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
  const [askRegions, setAskRegions] = useState(false);
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
      if (showsRegionStep(newAccount, regions)) setAskRegions(true);
      else onConsented();
    } catch (err) {
      console.error(err);
      const failure = consentSubmitFailure(err, newAccount);
      if (failure.field === "username") setUsernameError(failure.message);
      else setBanner(failure);
    } finally {
      setSubmitting(false);
    }
  };

  if (askRegions) {
    return (
      <RegionStep
        accountState={accountState}
        onDone={onConsented}
        regions={regions}
      />
    );
  }

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
          ? "Choose your public display name and review the terms to finish creating your account."
          : `Logjam's Terms of Use and Privacy Policy have changed (last updated ${consentVersion}). Review them and confirm your agreement to keep using Logjam.`}
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
          hint={USERNAME_HINT}
          autoCapitalize="none"
          autoComplete="username"
          editable={!submitting}
        />
      ) : null}
      <TermsSwitch
        updated={!newAccount}
        checked={agreed}
        onChange={(next) => {
          setAgreed(next);
          setBanner(null);
        }}
      />
      {newAccount ? (
        <SwitchRow
          title={SIGN_IN_COPY.ageConfirm}
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
