// Blocking re-consent screen — Agree or Sign out only (mirrors Logjam Web
// ConsentGate). Shown when needsReconsent() is true for the fetched current
// user; the server rejects any consentVersion other than the one it named.
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { messageFromError } from "@logjam/shared";

import type { SignOutHandler } from "../offline/signOutConfirm";
import { updateConsent } from "../api/queries";
import {
  PRIVACY_POLICY_URL,
  TERMS_URL,
  openLegalDocument,
} from "../legalLinks";
import { spacing, makeStyles } from "../theme";
import { Button, ErrorBanner, TextLink } from "../ui";

export function ConsentGate({
  consentVersion,
  onConsented,
  onSignOut,
}: {
  /** The version the server named, which is the only one it will record. */
  consentVersion: string;
  onConsented: () => void;
  onSignOut: SignOutHandler;
}) {
  const styles = useStyles();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // No nav header on the gates, so the status-bar/camera inset is ours to clear.
  const insets = useSafeAreaInsets();

  const agree = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await updateConsent(consentVersion);
      onConsented();
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(
          err,
          "Couldn't record your consent. Please try again.",
        ),
      );
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
      <Text style={styles.title}>Terms & privacy</Text>
      <Text style={styles.body}>
        Logjam&apos;s Terms of Use and Privacy Policy have changed (last updated{" "}
        {consentVersion}). Please review them and confirm your agreement to keep
        using Logjam.
      </Text>
      <TextLink
        label="Read the Terms of Use"
        onPress={() => openLegalDocument(TERMS_URL)}
      />
      <TextLink
        label="Read the Privacy Policy"
        onPress={() => openLegalDocument(PRIVACY_POLICY_URL)}
      />
      {error ? <ErrorBanner message={error} onRetry={agree} /> : null}
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
