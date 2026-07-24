// Blocking re-consent screen — Agree or Sign out only (mirrors web
// ConsentGate; MOBILE_DESIGN_BRIEF auth shell). Shown when needsReconsent()
// is true for the fetched current user; the server rejects any consentVersion
// other than CURRENT_CONSENT_VERSION.
import { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { CURRENT_CONSENT_VERSION, messageFromError } from "@logjam/shared";

import { updateConsent } from "../api/queries";
import { fontSize, fontWeight, lineHeight, spacing, theme } from "../theme";
import { Button, ErrorBanner } from "../ui";

export function ConsentGate({
  onConsented,
  onSignOut,
}: {
  onConsented: () => void;
  onSignOut: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agree = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await updateConsent(CURRENT_CONSENT_VERSION);
      onConsented();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't record your consent. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Terms & privacy</Text>
      <Text style={styles.body}>
        Logjam&apos;s terms of service or privacy policy have changed since you
        last agreed. Please review them at logjamnsw.com and agree to continue.
      </Text>
      {error ? <ErrorBanner message={error} onRetry={agree} /> : null}
      <Button label="Agree and continue" onPress={agree} loading={submitting} />
      <Button label="Sign out" variant="ghost" onPress={onSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing(3),
    gap: spacing(2),
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: theme.textPrimary },
  body: { fontSize: fontSize.base, color: theme.textPrimary, lineHeight: lineHeight.body },
});
