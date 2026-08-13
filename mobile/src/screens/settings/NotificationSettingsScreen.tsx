// Settings → Notifications: the one page whose every switch lives on the user
// record (`PATCH /users/me`), which is what makes it the page that can state the
// reason ONCE instead of on every row.
//
// The two email switches for topo jobs and topo exports are kept even though
// mobile cannot start either — they are account-wide EMAIL settings, and telling
// someone holding their phone to find a laptop to stop an email is not an
// answer. `geoPdfEmail` is directly mobile-relevant (this app imports and
// auto-downloads them) and both in-app kinds are live here.
//
// The OS row is not a preference and is deliberately last: no in-app switch can
// do anything if Android is dropping the notification, and that is a fact about
// the phone rather than about the account, so it sits under its own header.
//
// PRIVACY: booleans and a permission state. Push payloads themselves carry
// opaque ids only (mobile/CLAUDE.md).
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking } from "react-native";
import * as Notifications from "expo-notifications";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  messageFromError,
  type NotificationPreferences,
} from "@logjam/shared";

import { apiFetch } from "../../api/apiFetch";
import { fetchCurrentUser, useApiQuery } from "../../api/queries";
import { useAccountState } from "../../auth/AccountStateContext";
import { capabilityStatus, unavailableReasonText } from "../../auth/capabilities";
import { useConnectivity } from "../../map/connectivity";
import { requestPushPermission } from "../../notifications/pushRegistration";
import type { TUser } from "../../api/types";
import {
  ErrorBanner,
  Row,
  ScreenScroll,
  SectionHeader,
  Toast,
  type ToastMessage,
} from "../../ui";
import { PreferenceRow } from "./settingsKit";

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

export function NotificationSettingsScreen() {
  const { accountState } = useAccountState();
  const userQuery = useApiQuery(
    fetchCurrentUser,
    "Couldn't load your settings.",
    accountState !== "guest",
  );
  const online = useConnectivity() === "online";
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ text, tone, nonce: Date.now() });
  }, []);

  const user = userQuery.data;

  // Optimistic with rollback: a switch that waits for a round trip feels broken,
  // and a switch that lies about a failed save is worse.
  const [notifications, setNotifications] = useState<NotificationPreferences | null>(null);
  // Re-seed on the VALUE, not on `user.id` — which never changes for a signed-in
  // user, so a preference edited on another device and pulled in by a refetch
  // while this screen stayed mounted was silently dropped. Keying on the
  // serialized value (rather than the object, which a refetch mints fresh every
  // time) is also what keeps an in-flight optimistic toggle from being clobbered
  // by an identical server answer.
  const serverNotificationsKey = user
    ? JSON.stringify({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...(user.uiPreferences?.notifications ?? {}),
      })
    : null;
  useEffect(() => {
    if (!serverNotificationsKey) return;
    setNotifications(JSON.parse(serverNotificationsKey) as NotificationPreferences);
  }, [serverNotificationsKey]);

  const toggleNotification = useCallback(
    (key: keyof NotificationPreferences) => {
      setNotifications((current) => {
        if (!current) return current;
        const next = { ...current, [key]: !current[key] };
        apiFetch<TUser>("/users/me", {
          method: "PATCH",
          body: { notifications: { [key]: next[key] } },
        }).catch((err: unknown) => {
          console.error(err);
          setNotifications(current);
          notify(messageFromError(err, "Couldn't save that setting."), "error");
        });
        return next;
      });
    },
    [notify],
  );

  // The OS permission, re-read when the user comes back from Android's settings
  // — which is the only place it can change, and the whole point of the row.
  const [pushAllowed, setPushAllowed] = useState<boolean | null>(null);
  // Whether Android will still show its dialog. This screen is the one place
  // that asks: a POST_NOTIFICATIONS prompt at cold start lands over a blank
  // screen, and a denial there is permanent for the install (MRUN-004).
  const [canAskPush, setCanAskPush] = useState(false);
  useEffect(() => {
    const read = () => {
      Notifications.getPermissionsAsync()
        .then((status) => {
          setPushAllowed(status.granted);
          setCanAskPush(status.canAskAgain);
        })
        .catch(console.error);
    };
    read();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") read();
    });
    return () => subscription.remove();
  }, []);

  const serverPrefs = capabilityStatus("serverPrefs", accountState, online);
  const blocked: string | undefined =
    serverPrefs.status === "unavailable"
      ? unavailableReasonText(serverPrefs.reason)
      : userQuery.error
        ? "Couldn't reach your account"
        : undefined;
  const ready = blocked === undefined && notifications !== null;

  return (
    <>
      <ScreenScroll>
        <SectionHeader label="Email me when" />
        {/* Reported here rather than as a screen-level error: the OS row below
            works regardless, and this is the part that needs the fetch. */}
        {online && userQuery.error ? (
          <ErrorBanner message={userQuery.error} onRetry={userQuery.refetch} />
        ) : null}
        {NOTIFICATION_ROWS.filter((row) => row.group === "email").map((row) => (
          <PreferenceRow
            key={row.key}
            title={row.title}
            subtitle={blocked}
            value={notifications?.[row.key] ?? false}
            ready={ready}
            onToggle={() => toggleNotification(row.key)}
          />
        ))}

        <SectionHeader label="Notify me in the app about" />
        {NOTIFICATION_ROWS.filter((row) => row.group === "inApp").map((row) => (
          <PreferenceRow
            key={row.key}
            title={row.title}
            subtitle={blocked}
            value={notifications?.[row.key] ?? false}
            ready={ready}
            onToggle={() => toggleNotification(row.key)}
          />
        ))}

        <SectionHeader label="This phone" />
        {/* Not a switch: Android owns this one, so the row reports it and
            either asks (the one place in the app that does) or opens the place
            it can be changed. A toggle here would be a lie. */}
        <Row
          icon="smartphone"
          title="Notifications from Logjam"
          subtitle={
            pushAllowed === null
              ? undefined
              : pushAllowed
                ? "Allowed"
                : canAskPush
                  ? "Not allowed yet — tap to allow"
                  : "Blocked in your phone's settings"
          }
          onPress={() => {
            if (!pushAllowed && canAskPush) {
              requestPushPermission()
                .then((granted) => {
                  setPushAllowed(granted);
                  if (!granted) setCanAskPush(false);
                })
                .catch(console.error);
              return;
            }
            void Linking.openSettings();
          }}
        />
      </ScreenScroll>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </>
  );
}
