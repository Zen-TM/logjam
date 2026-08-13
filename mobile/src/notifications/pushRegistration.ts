// Push-token lifecycle (Stage 3): register on login / app start, unregister
// on sign-out. Best-effort throughout — a push registration failure must
// never block sign-in (mirror of the server's best-effort fan-out).
//
// Privacy: the Expo push token is an opaque routing handle, not a secret and
// not user data; server-side it is bound to the signed-in user. Pushes carry
// generic titles + opaque IDs only (enforced server-side in services/push.ts).
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

import { apiFetch } from "../api/apiFetch";

const PUSH_TOKEN_KEY = "logjam_push_token";

export async function registerForPushNotifications(): Promise<void> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return; // user said no — respect it, no retry nag

    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      // Fail loudly in dev — a missing projectId means misconfigured app.json.
      throw new Error("Missing EAS projectId for push token");
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    await apiFetch("/devices", {
      method: "POST",
      body: { token, platform: Platform.OS },
    });
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
  } catch (err) {
    // Best-effort: push is an enhancement; the inbox remains authoritative.
    console.error(err);
  }
}

export async function unregisterPushNotifications(): Promise<void> {
  let token: string | null = null;
  try {
    token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    if (!token) return;
    await apiFetch(`/devices/${encodeURIComponent(token)}`, { method: "DELETE" });
  } catch (err) {
    // Best-effort: server-side pruning (DeviceNotRegistered) is the backstop.
    console.error(err);
  } finally {
    // Unconditionally, even when the DELETE never reached the server: a token
    // we can no longer revoke is one this install must stop claiming to own.
    // Keeping it meant an offline sign-out left the departing user's binding
    // in SecureStore, and the next user's re-registration is what would have
    // moved it — a step that never runs if they decline notifications.
    if (token) await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY).catch(console.error);
  }
}
