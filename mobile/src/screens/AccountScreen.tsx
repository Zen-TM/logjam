// Account — "who am I on this service, and what am I using of it?"
//
// The two quota meters ARE the question this screen exists for, so unlike the
// Saved tab (where storage is context) they get real weight here (DESIGN.md §1,
// §4). Everything else is the sign-in identity and the two irreversible things:
// signing out (which drops unsynced work — the confirmation lives in App.tsx)
// and deleting the account.
//
// One sheet, four modes (§6 — never a second sheet): rename, change email
// (two-step, the code goes to the new address), and delete.
//
// PRIVACY: username, email, byte counts and tile counts. The email appears here
// and nowhere else in the app — friend search and lists are username-only, per
// the root CLAUDE.md convention.
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  confirmUserAttribute,
  updateUserAttribute,
} from "aws-amplify/auth";
import { messageFromError } from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { fetchCurrentUser, useApiQuery } from "../api/queries";
import type { TUser } from "../api/types";
import { CLIENT_VERSION } from "../config";
import { formatBytes } from "../format";
import { useConnectivity } from "../map/connectivity";
import { assetHue, fontSize, fontWeight, spacing, theme } from "../theme";
import {
  BottomSheet,
  Button,
  CapacityBar,
  ErrorBanner,
  ErrorState,
  HeroHeader,
  IconButton,
  LoadingState,
  Row,
  ScreenScroll,
  SectionHeader,
  TextField,
  Toast,
  type ToastMessage,
} from "../ui";

function updateUsername(username: string): Promise<TUser> {
  return apiFetch<TUser>("/users/me", { method: "PATCH", body: { username } });
}

function deleteAccount(): Promise<void> {
  return apiFetch<void>("/users/me", { method: "DELETE" });
}

type SheetMode = "closed" | "username" | "email" | "delete";

const SHEET_TITLE: Record<Exclude<SheetMode, "closed">, string> = {
  username: "Change username",
  email: "Change email",
  delete: "Delete account",
};

export function AccountScreen({
  onBack,
  onSignOut,
  onOpenFriends,
}: {
  onBack: () => void;
  onSignOut: () => void;
  onOpenFriends: () => void;
}) {
  const query = useApiQuery(fetchCurrentUser, "Couldn't load your account.");
  const online = useConnectivity() === "online";
  const [sheet, setSheet] = useState<SheetMode>("closed");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ text, tone, nonce: Date.now() });
  }, []);

  if (query.loading && !query.data) return <LoadingState />;
  if (!query.data) {
    return (
      <ErrorState
        message={query.error ?? "Couldn't load your account."}
        onRetry={query.refetch}
      />
    );
  }
  const user = query.data;

  const tileResetLabel = user.monthlyTileResetAt
    ? new Date(user.monthlyTileResetAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : null;

  return (
    <View style={styles.root}>
      <HeroHeader
        eyebrow="Account"
        title={user.username}
        onBack={onBack}
        action={
          <IconButton
            icon="edit-2"
            accessibilityLabel="Change username"
            color={theme.accent}
            filled
            onPress={() => setSheet("username")}
          />
        }
      >
        <Text style={styles.email}>{user.email}</Text>
      </HeroHeader>

      <ScreenScroll padded={false} contentStyle={styles.body}>
        {/* Two quotas, same shape. `total` on a one-segment bar is exactly the
            "used vs capacity" case CapacityBar's remainder track is for. */}
        <SectionHeader label="Storage" />
        <CapacityBar
          segments={[
            {
              label: "Used",
              value: user.storageUsedBytes,
              color: theme.accent,
              display: formatBytes(user.storageUsedBytes),
            },
          ]}
          total={user.storageQuotaBytes}
          legend={false}
        />
        <Text style={styles.meterLabel}>
          {formatBytes(user.storageUsedBytes)} of {formatBytes(user.storageQuotaBytes)}
          <Text style={styles.meterHint}> · photos, videos and topo outputs</Text>
        </Text>

        <SectionHeader label="LiDAR tiles this month" />
        <CapacityBar
          segments={[
            {
              label: "Rendered",
              value: user.monthlyTileUsage,
              color: assetHue.overlay,
              display: String(user.monthlyTileUsage),
            },
          ]}
          total={user.monthlyTileQuota}
          legend={false}
        />
        <Text style={styles.meterLabel}>
          {user.monthlyTileUsage} of {user.monthlyTileQuota}
          {tileResetLabel ? (
            <Text style={styles.meterHint}> · resets {tileResetLabel}</Text>
          ) : null}
        </Text>

        <SectionHeader label="Sign-in" />
        <Row
          icon="mail"
          title="Email"
          subtitle={online ? user.email : "Needs a connection"}
          disabled={!online}
          onPress={() => setSheet("email")}
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
        />
        <Row
          icon="users"
          title="Friends"
          subtitle={online ? undefined : "Needs a connection"}
          disabled={!online}
          onPress={onOpenFriends}
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
        />

        <SectionHeader label="Leaving" />
        <Button label="Sign out" variant="outlineAccent" icon="log-out" onPress={onSignOut} />
        <Row
          icon="trash-2"
          hue={theme.warning}
          title="Delete account"
          subtitle={online ? undefined : "Needs a connection"}
          disabled={!online}
          onPress={() => setSheet("delete")}
        />

        <Text style={styles.version}>{CLIENT_VERSION}</Text>
      </ScreenScroll>

      <BottomSheet
        visible={sheet !== "closed"}
        onClose={() => setSheet("closed")}
        title={sheet === "closed" ? "" : SHEET_TITLE[sheet]}
      >
        {sheet === "username" ? (
          <UsernameForm
            current={user.username}
            onSaved={() => {
              query.refetch();
              setSheet("closed");
              notify("Username updated.");
            }}
          />
        ) : null}
        {sheet === "email" ? (
          <EmailForm
            current={user.email}
            onSaved={() => {
              query.refetch();
              setSheet("closed");
              notify("Email updated.");
            }}
          />
        ) : null}
        {sheet === "delete" ? (
          <DeleteAccountForm username={user.username} onDeleted={onSignOut} />
        ) : null}
      </BottomSheet>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

function UsernameForm({
  current,
  onSaved,
}: {
  current: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === current) return;
    setSaving(true);
    setError(null);
    try {
      await updateUsername(trimmed);
      onSaved();
    } catch (err) {
      console.error(err);
      // The server's own 409 text ("Username already taken") is worth showing,
      // which is what messageFromError prefers when the API supplies one.
      setError(messageFromError(err, "Couldn't save that username."));
    } finally {
      setSaving(false);
    }
  }, [current, onSaved, value]);

  return (
    <View style={styles.form}>
      <TextField
        label="Username"
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
      />
      <Text style={styles.formHint}>
        This is the name friends search for when they share a canyon with you.
      </Text>
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        label="Save username"
        icon="check"
        loading={saving}
        disabled={!value.trim() || value.trim() === current}
        onPress={() => void save()}
      />
    </View>
  );
}

/**
 * Two steps, because Cognito owns the email and verifies it: request the change,
 * then confirm with the code sent to the NEW address. The step is state, not a
 * second sheet.
 */
function EmailForm({ current, onSaved }: { current: string; onSaved: () => void }) {
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await updateUserAttribute({
        userAttribute: { attributeKey: "email", value: trimmed },
      });
      setStep("confirm");
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't start the email change."));
    } finally {
      setBusy(false);
    }
  }, [email]);

  const confirm = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await confirmUserAttribute({ userAttributeKey: "email", confirmationCode: trimmed });
      onSaved();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "That code didn't work."));
    } finally {
      setBusy(false);
    }
  }, [code, onSaved]);

  if (step === "confirm") {
    return (
      <View style={styles.form}>
        <Text style={styles.formHint}>
          We sent a code to {email.trim()}. Enter it to finish the change.
        </Text>
        <TextField
          label="Confirmation code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
        />
        {error ? <ErrorBanner message={error} /> : null}
        <Button
          label="Confirm email"
          icon="check"
          loading={busy}
          disabled={!code.trim()}
          onPress={() => void confirm()}
        />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <Text style={styles.formHint}>Signed in with {current}.</Text>
      <TextField
        label="New email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        label="Send code"
        icon="mail"
        loading={busy}
        disabled={!email.trim()}
        onPress={() => void request()}
      />
    </View>
  );
}

/**
 * Deletion confirms by typing the username, which is the web's bar and a higher
 * one than an Alert: the sheet can carry the whole consequence in readable copy,
 * where an Android Alert would ellipsise it (§7 — consequence copy belongs in the
 * dialog, and here the sheet IS the dialog). No second Alert on top; the typing
 * is the confirmation.
 */
function DeleteAccountForm({
  username,
  onDeleted,
}: {
  username: string;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === username;

  const run = useCallback(async () => {
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      // Sign-out is also what wipes this device's mirror and outbox.
      onDeleted();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't delete your account."));
      setBusy(false);
    }
  }, [matches, onDeleted]);

  return (
    <View style={styles.form}>
      <Text style={styles.danger}>This can&apos;t be undone.</Text>
      <Text style={styles.formHint}>
        Your canyons, trips, notes, photos and shares are deleted from the server
        and from this phone. Canyons other people copied from you stay theirs.
      </Text>
      <TextField
        label={`Type ${username} to confirm`}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="none"
      />
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        label="Delete my account"
        icon="trash-2"
        variant="outlineAccent"
        loading={busy}
        disabled={!matches}
        onPress={() => void run()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  email: { color: theme.textMuted, fontSize: fontSize.sm },
  body: { padding: spacing(2), gap: spacing(1), paddingBottom: spacing(4) },
  meterLabel: { color: theme.textPrimary, fontSize: fontSize.sm },
  meterHint: { color: theme.textMuted },
  form: { gap: spacing(1.5) },
  formHint: { color: theme.textMuted, fontSize: fontSize.sm },
  danger: {
    color: theme.warning,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  version: { color: theme.textMuted, fontSize: fontSize.xs, paddingTop: spacing(1) },
});
