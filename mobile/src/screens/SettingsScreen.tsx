// Settings — the account-level preferences the web keeps in its Account panel,
// plus the two things only a phone has an opinion about (what this device holds,
// and what locks it).
//
// LAYOUT: a plain settings list, so per DESIGN.md §2 it keeps `ScreenScroll` and
// the native header rather than being given a hero. There is no headline metric
// here; a hero whose only content is the word "Settings" is exactly the pattern
// the hero rule exists to replace.
//
// Sections, in the order someone actually goes looking for them: Theme (the one
// people come here to change), Notifications, Downloads, Your own fields,
// This phone, About.
//
// ONLINE/OFFLINE (§10): everything except the theme edits `User.uiPreferences`,
// an account-level blob every device and the browser share — no offline queue,
// so those rows disable with the reason in place of their subtitle. The theme is
// the exception: it is one scalar with no merge hazard, so it applies to this
// device immediately and only its account copy needs a connection.
//
// PRIVACY: nothing here reads canyon data. The "This phone" section deliberately
// states WHAT kinds of data are on the device and what gates them, and names no
// canyon and no coordinate (§11).
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  THEME_SCHEMES,
  THEME_SCHEME_ORDER,
  isThemeSchemeId,
  messageFromError,
  type NotificationPreferences,
  type ThemeSchemeId,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import {
  customFieldDefsOf,
  fetchCurrentUser,
  useApiQuery,
  type CustomFieldEntity,
} from "../api/queries";
import { CLIENT_VERSION } from "../config";
import { CustomFieldForm, CustomFieldList } from "../customFields/CustomFieldsEditor";
import { useConnectivity } from "../map/connectivity";
import {
  activeThemeSchemeId,
  fontSize,
  fontWeight,
  persistThemeSchemeId,
  radius,
  spacing,
  surface,
  theme,
  withAlpha,
} from "../theme";
import type { TUser } from "../api/types";
import {
  BottomSheet,
  Button,
  ErrorBanner,
  Row,
  ScreenScroll,
  SectionHeader,
  Toast,
  Toggle,
  type ToastMessage,
} from "../ui";

// One row per switch, so the list is data and a new preference is one entry.
// Copy is deliberately first-person and about the OUTCOME ("Email me when…"),
// matching the web's wording so a user who set these in a browser recognises
// them here.
const NOTIFICATION_ROWS: {
  key: keyof NotificationPreferences;
  title: string;
  group: "email" | "inApp";
}[] = [
  { key: "topoEmail", title: "A LiDAR topo job finishes", group: "email" },
  { key: "exportEmail", title: "A topo export is ready", group: "email" },
  { key: "geoPdfEmail", title: "A GeoPDF is ready", group: "email" },
  { key: "friendRequestInApp", title: "Friend requests", group: "inApp" },
  { key: "shareInApp", title: "A canyon is shared with me", group: "inApp" },
];

function updateUserPreferences(body: Record<string, unknown>): Promise<TUser> {
  return apiFetch<TUser>("/users/me", { method: "PATCH", body });
}

type SheetMode =
  | { kind: "closed" }
  | { kind: "fields"; entity: CustomFieldEntity }
  | { kind: "fieldForm"; entity: CustomFieldEntity; editing: TripLogCustomFieldDef | null };

export function SettingsScreen() {
  const userQuery = useApiQuery(fetchCurrentUser, "Couldn't load your settings.");
  const online = useConnectivity() === "online";
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ text, tone, nonce: Date.now() });
  }, []);

  const user = userQuery.data;

  // ── theme ────────────────────────────────────────────────────────────────
  // `chosenSchemeId` is what the user has SELECTED; `activeThemeSchemeId` is
  // what this launch is painted in. They differ after a change here — and also
  // after a change made in the browser since this app last started — which is
  // exactly when the "next time you open Logjam" note is true.
  const [chosenSchemeId, setChosenSchemeId] = useState<ThemeSchemeId>(activeThemeSchemeId);
  useEffect(() => {
    const accountScheme = user?.uiPreferences?.themeSchemeId;
    if (isThemeSchemeId(accountScheme)) setChosenSchemeId(accountScheme);
  }, [user?.id, user?.uiPreferences?.themeSchemeId]);

  const chooseScheme = useCallback(
    (id: ThemeSchemeId) => {
      setChosenSchemeId(id);
      // Device first: this is what makes the app open in the right colours with
      // no signal, and it must not depend on the request below.
      if (!persistThemeSchemeId(id)) {
        notify("This phone wouldn't store that theme.", "error");
        return;
      }
      updateUserPreferences({ themeSchemeId: id }).catch((err: unknown) => {
        console.error(err);
        // True, and specific: the phone kept it, the account didn't get it.
        notify("Saved on this phone, but it didn't reach your account.", "error");
      });
    },
    [notify],
  );

  // ── notification preferences ─────────────────────────────────────────────
  // Optimistic with rollback: a switch that waits for a round trip feels broken,
  // and a switch that lies about a failed save is worse.
  const [notifications, setNotifications] = useState<NotificationPreferences | null>(null);
  useEffect(() => {
    if (!user) return;
    setNotifications({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(user.uiPreferences?.notifications ?? {}),
    });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleNotification = useCallback(
    (key: keyof NotificationPreferences) => {
      setNotifications((current) => {
        if (!current) return current;
        const next = { ...current, [key]: !current[key] };
        updateUserPreferences({ notifications: { [key]: next[key] } }).catch(
          (err: unknown) => {
            console.error(err);
            setNotifications(current);
            notify(messageFromError(err, "Couldn't save that setting."), "error");
          },
        );
        return next;
      });
    },
    [notify],
  );

  // ── downloads ────────────────────────────────────────────────────────────
  const [autoDownloadGeoPdfs, setAutoDownloadGeoPdfs] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user) return;
    setAutoDownloadGeoPdfs(user.uiPreferences?.autoDownloadGeoPdfs ?? true);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAutoDownload = useCallback(() => {
    setAutoDownloadGeoPdfs((current) => {
      if (current === null) return current;
      const next = !current;
      updateUserPreferences({ autoDownloadGeoPdfs: next }).catch((err: unknown) => {
        console.error(err);
        setAutoDownloadGeoPdfs(current);
        notify(messageFromError(err, "Couldn't save that setting."), "error");
      });
      return next;
    });
  }, [notify]);

  // ── custom fields ────────────────────────────────────────────────────────
  const [sheet, setSheet] = useState<SheetMode>({ kind: "closed" });
  const [tripFieldDefs, setTripFieldDefs] = useState<TripLogCustomFieldDef[]>([]);
  const [canyonFieldDefs, setCanyonFieldDefs] = useState<TripLogCustomFieldDef[]>([]);
  useEffect(() => {
    if (!user) return;
    setTripFieldDefs(customFieldDefsOf(user, "tripLog"));
    setCanyonFieldDefs(customFieldDefsOf(user, "canyon"));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const defsFor = (entity: CustomFieldEntity) =>
    entity === "tripLog" ? tripFieldDefs : canyonFieldDefs;
  const setDefsFor = (entity: CustomFieldEntity, next: TripLogCustomFieldDef[]) => {
    if (entity === "tripLog") setTripFieldDefs(next);
    else setCanyonFieldDefs(next);
  };

  // Why a preference row can't be touched right now — offline is one reason, a
  // failed account fetch is another, and a dead row with no reason is the state
  // this must never render in (§8).
  const prefsBlocked: string | undefined = !online
    ? "Needs a connection"
    : userQuery.error
      ? "Couldn't reach your account"
      : undefined;
  const prefsReady = prefsBlocked === undefined;

  return (
    <>
      <ScreenScroll>
        {/* ── Theme ─────────────────────────────────────────────────────── */}
        <SectionHeader label="Theme" />
        <View style={styles.schemes}>
          {THEME_SCHEME_ORDER.map((id) => (
            <SchemeCard
              key={id}
              schemeId={id}
              selected={id === chosenSchemeId}
              onPress={() => chooseScheme(id)}
            />
          ))}
        </View>
        {chosenSchemeId !== activeThemeSchemeId ? (
          <Text style={styles.hint}>
            {THEME_SCHEMES[chosenSchemeId].name} applies everywhere next time you
            open Logjam.
          </Text>
        ) : null}

        {/* ── Notifications ─────────────────────────────────────────────── */}
        <SectionHeader label="Email me when" />
        {/* Reported here, not as a screen-level error: the theme section above
            works regardless, and this is the part that actually needs the fetch. */}
        {online && userQuery.error ? (
          <ErrorBanner message={userQuery.error} onRetry={userQuery.refetch} />
        ) : null}
        {NOTIFICATION_ROWS.filter((row) => row.group === "email").map((row) => (
          <PreferenceRow
            key={row.key}
            title={row.title}
            subtitle={prefsBlocked}
            value={notifications?.[row.key] ?? false}
            ready={notifications !== null && prefsReady}
            onToggle={() => toggleNotification(row.key)}
          />
        ))}

        <SectionHeader label="Notify me in the app about" />
        {NOTIFICATION_ROWS.filter((row) => row.group === "inApp").map((row) => (
          <PreferenceRow
            key={row.key}
            title={row.title}
            subtitle={prefsBlocked}
            value={notifications?.[row.key] ?? false}
            ready={notifications !== null && prefsReady}
            onToggle={() => toggleNotification(row.key)}
          />
        ))}

        {/* ── Downloads ─────────────────────────────────────────────────── */}
        <SectionHeader label="Downloads" />
        <PreferenceRow
          title="Auto-download finished GeoPDFs"
          subtitle={prefsBlocked ?? "Onto this phone, as soon as one is generated"}
          value={autoDownloadGeoPdfs ?? false}
          ready={autoDownloadGeoPdfs !== null && prefsReady}
          onToggle={toggleAutoDownload}
        />

        {/* ── Custom fields ─────────────────────────────────────────────── */}
        <SectionHeader label="Your own fields" />
        <Row
          icon="tag"
          title="Trip fields"
          subtitle={prefsBlocked ?? fieldCountLabel(tripFieldDefs.length)}
          disabled={!prefsReady}
          onPress={() => setSheet({ kind: "fields", entity: "tripLog" })}
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
        />
        <Row
          icon="tag"
          title="Canyon fields"
          subtitle={prefsBlocked ?? fieldCountLabel(canyonFieldDefs.length)}
          disabled={!prefsReady}
          onPress={() => setSheet({ kind: "fields", entity: "canyon" })}
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
        />

        {/* ── This phone ────────────────────────────────────────────────── */}
        {/* Not a setting — an answer. "What of mine is on this device, and what
            protects it?" is a fair question to have about an offline app, and
            leaving it unanswered doesn't make the answer better. */}
        <SectionHeader label="This phone" />
        <Row
          icon="lock"
          title="App lock"
          // No "Automatic" pill beside this: the sentence already says it, and
          // the pill's width was what forced the sentence to ellipsise.
          subtitle="Automatic once offline data is stored here. Unlocks with your phone's fingerprint or PIN."
          subtitleNumberOfLines={2}
        />
        <Row
          icon="hard-drive"
          title="Downloads and imports"
          subtitle="Managed on the Saved tab"
        />

        {/* ── About ─────────────────────────────────────────────────────── */}
        <SectionHeader label="About" />
        <Text style={styles.version}>{CLIENT_VERSION}</Text>
      </ScreenScroll>

      {/* One sheet, two modes (§6: never a second sheet — swap the content). */}
      <BottomSheet
        visible={sheet.kind !== "closed"}
        // Inside the form, a drag or a backdrop tap means "back to the list".
        onClose={() =>
          setSheet((current) =>
            current.kind === "fieldForm"
              ? { kind: "fields", entity: current.entity }
              : { kind: "closed" },
          )
        }
        title={sheetTitle(sheet)}
        footer={
          sheet.kind === "fieldForm" ? (
            // The form body carries its own save action; this is the way back.
            <Button
              label="Cancel"
              variant="outlineAccent"
              onPress={() => setSheet({ kind: "fields", entity: sheet.entity })}
            />
          ) : (
            <Button label="Done" icon="check" onPress={() => setSheet({ kind: "closed" })} />
          )
        }
      >
        {sheet.kind === "fields" ? (
          <CustomFieldList
            entity={sheet.entity}
            defs={defsFor(sheet.entity)}
            online={online}
            onAdd={() => setSheet({ kind: "fieldForm", entity: sheet.entity, editing: null })}
            onEdit={(def) =>
              setSheet({ kind: "fieldForm", entity: sheet.entity, editing: def })
            }
          />
        ) : null}
        {sheet.kind === "fieldForm" ? (
          <CustomFieldForm
            entity={sheet.entity}
            defs={defsFor(sheet.entity)}
            online={online}
            editing={sheet.editing}
            onSaved={(next, message) => {
              setDefsFor(sheet.entity, next);
              notify(message);
            }}
            onFailed={(message) => notify(message, "error")}
            onDone={() => setSheet({ kind: "fields", entity: sheet.entity })}
          />
        ) : null}
      </BottomSheet>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </>
  );
}

function sheetTitle(sheet: SheetMode): string {
  if (sheet.kind === "closed") return "";
  const noun = sheet.entity === "tripLog" ? "Trip" : "Canyon";
  if (sheet.kind === "fields") return `${noun} fields`;
  return sheet.editing ? sheet.editing.label : `New ${noun.toLowerCase()} field`;
}

function fieldCountLabel(count: number): string {
  if (count === 0) return "None yet";
  return `${count} field${count === 1 ? "" : "s"}`;
}

/**
 * A preference switch. `ready` is false until the value is actually known (or
 * while it can't be changed) — a switch rendered in its default position before
 * the account's value has loaded is a lie the user can act on.
 */
function PreferenceRow({
  title,
  subtitle,
  value,
  ready,
  onToggle,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  ready: boolean;
  onToggle: () => void;
}) {
  return (
    <Row
      title={title}
      subtitle={subtitle}
      disabled={!ready}
      right={
        <Toggle
          value={value}
          onValueChange={onToggle}
          disabled={!ready}
          accessibilityLabel={title}
        />
      }
    />
  );
}

/**
 * One theme option: its name, and the three tokens that actually decide how the
 * app looks — page, card, accent. Swatches rather than a description because the
 * choice is entirely visual, and a scheme's own colours are the only honest
 * preview available on a screen painted in a different scheme.
 */
function SchemeCard({
  schemeId,
  selected,
  onPress,
}: {
  schemeId: ThemeSchemeId;
  selected: boolean;
  onPress: () => void;
}) {
  const scheme = THEME_SCHEMES[schemeId];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={scheme.name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.scheme,
        selected && styles.schemeSelected,
        pressed && styles.schemePressed,
      ]}
    >
      <View style={styles.swatches}>
        {[scheme.tokens.primary, scheme.tokens.secondary, scheme.tokens.accent].map(
          (color) => (
            <View key={color} style={[styles.swatch, { backgroundColor: color }]} />
          ),
        )}
      </View>
      <Text style={styles.schemeName} numberOfLines={1}>
        {scheme.name}
      </Text>
      {selected ? (
        <Feather name="check" size={16} color={theme.accent} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  schemes: { gap: spacing(1) },
  scheme: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: surface.border,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    minHeight: 56,
  },
  schemeSelected: {
    borderColor: theme.accent,
    backgroundColor: withAlpha(theme.accent, 0.1),
  },
  schemePressed: { backgroundColor: surface.cardPressed },
  swatches: { flexDirection: "row", gap: 3 },
  // The hairline is load-bearing, not decoration: Sandstone's `secondary` IS the
  // card colour these sit on, so without an edge that swatch simply vanishes and
  // the scheme looks like it has two colours.
  swatch: {
    width: 18,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: withAlpha(theme.textPrimary, 0.2),
  },
  schemeName: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  hint: { color: theme.textMuted, fontSize: fontSize.sm },
  version: { color: theme.textMuted, fontSize: fontSize.xs },
});
