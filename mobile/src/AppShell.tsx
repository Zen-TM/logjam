// Authenticated app shell: bottom tabs (Map / Canyons / Logs / Saved / More)
// with native stacks for detail screens, behind the consent gate. The More
// tab is a hub folding Inbox, Account, Friends, Sync issues and Settings off
// the tab bar.
import { useCallback, useEffect, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import {
  DarkTheme,
  NavigationContainer,
  type NavigationContainerRef,
} from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { needsReconsent } from "@logjam/shared";

import { fetchCurrentUser, getUnreadNotificationCount, useApiQuery } from "./api/queries";
import { getCachedUnreadCount } from "./sync/notificationsCache";
import { onMirrorChanged } from "./sync/syncDb";
import { registerSyncTriggers } from "./sync/syncEngine";
import { theme } from "./theme";
import { MapScreen } from "./map/MapScreen";
import { registerForPushNotifications } from "./notifications/pushRegistration";
import { SavedScreen } from "./saved/SavedScreen";
import { AccountScreen } from "./screens/AccountScreen";
import { CanyonDetailScreen } from "./screens/CanyonDetailScreen";
import { CanyonsScreen } from "./screens/CanyonsScreen";
import { ConsentGate } from "./screens/ConsentGate";
import { FriendsScreen } from "./screens/FriendsScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SyncIssuesScreen } from "./screens/SyncIssuesScreen";
import type { MirrorTrip } from "./sync/mirrorStore";
import { LogsScreen } from "./logs/LogsScreen";
import { TripDetailScreen } from "./logs/TripDetailScreen";
import { LoadingState } from "./ui/ScreenStates";

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: theme.accent,
    background: theme.primary,
    card: theme.secondary,
    text: theme.textPrimary,
    border: theme.secondary,
    notification: theme.accent,
  },
};

type MapStackParams = {
  // `focus` = "show on map" from Saved: a bbox to fit on arrival (see
  // MapScreen's `focus` prop). Params only — never persisted or logged.
  MapView:
    | { focus?: { bbox: [number, number, number, number]; nonce: number } }
    | undefined;
  MapCanyonDetail: { canyonId: string; name: string };
};

type CanyonsStackParams = {
  CanyonList: undefined;
  CanyonDetail: { canyonId: string; name: string };
};

type TripsStackParams = {
  TripList: undefined;
  TripDetail: { trip: MirrorTrip };
  TripCanyonDetail: { canyonId: string; name: string };
};

type SavedStackParams = {
  SavedHome: undefined;
};

type MoreStackParams = {
  MoreHome: undefined;
  Inbox: undefined;
  Account: undefined;
  Friends: undefined;
  SyncIssues: undefined;
  Settings: undefined;
};

const MapStack = createNativeStackNavigator<MapStackParams>();
const CanyonsStack = createNativeStackNavigator<CanyonsStackParams>();
const TripsStack = createNativeStackNavigator<TripsStackParams>();
const SavedStack = createNativeStackNavigator<SavedStackParams>();
const MoreStack = createNativeStackNavigator<MoreStackParams>();
const Tabs = createBottomTabNavigator();

const stackScreenOptions = {
  headerStyle: { backgroundColor: theme.secondary },
  headerTintColor: theme.textPrimary,
  contentStyle: { backgroundColor: theme.primary },
} as const;

function MapStackNav() {
  return (
    <MapStack.Navigator screenOptions={stackScreenOptions}>
      <MapStack.Screen name="MapView" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <MapScreen
            onOpenCanyon={(canyonId, name) =>
              navigation.navigate("MapCanyonDetail", { canyonId, name })
            }
            onOpenSaved={() => navigation.getParent()?.navigate("Saved")}
            focus={route.params?.focus ?? null}
          />
        )}
      </MapStack.Screen>
      <MapStack.Screen
        name="MapCanyonDetail"
        options={({ route }) => ({ title: route.params.name })}
      >
        {({ route }) => <CanyonDetailScreen canyonId={route.params.canyonId} />}
      </MapStack.Screen>
    </MapStack.Navigator>
  );
}

function SavedStackNav() {
  return (
    <SavedStack.Navigator screenOptions={stackScreenOptions}>
      {/* No native header: SavedScreen leads with its own HeroHeader. */}
      <SavedStack.Screen name="SavedHome" options={{ headerShown: false }}>
        {({ navigation }) => (
          <SavedScreen
            onOpenMap={(bbox) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: bbox ? { focus: { bbox, nonce: Date.now() } } : undefined,
              })
            }
          />
        )}
      </SavedStack.Screen>
    </SavedStack.Navigator>
  );
}

function CanyonsStackNav() {
  return (
    <CanyonsStack.Navigator screenOptions={stackScreenOptions}>
      <CanyonsStack.Screen name="CanyonList" options={{ title: "Canyons" }}>
        {({ navigation }) => (
          <CanyonsScreen
            onOpenCanyon={(canyon) =>
              navigation.navigate("CanyonDetail", { canyonId: canyon.id, name: canyon.name })
            }
          />
        )}
      </CanyonsStack.Screen>
      <CanyonsStack.Screen
        name="CanyonDetail"
        options={({ route }) => ({ title: route.params.name })}
      >
        {({ route }) => <CanyonDetailScreen canyonId={route.params.canyonId} />}
      </CanyonsStack.Screen>
    </CanyonsStack.Navigator>
  );
}

function TripsStackNav() {
  return (
    <TripsStack.Navigator screenOptions={stackScreenOptions}>
      {/* Logs and trip detail both carry their own HeroHeader, so the native
          header is off and the hero owns the back affordance (DESIGN.md §2). */}
      <TripsStack.Screen name="TripList" options={{ headerShown: false }}>
        {({ navigation }) => (
          <LogsScreen onOpenTrip={(trip) => navigation.navigate("TripDetail", { trip })} />
        )}
      </TripsStack.Screen>
      <TripsStack.Screen name="TripDetail" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <TripDetailScreen
            trip={route.params.trip}
            onBack={() => navigation.goBack()}
            onOpenCanyon={(canyonId, name) =>
              navigation.navigate("TripCanyonDetail", { canyonId, name })
            }
          />
        )}
      </TripsStack.Screen>
      <TripsStack.Screen
        name="TripCanyonDetail"
        options={({ route }) => ({ title: route.params.name })}
      >
        {({ route }) => <CanyonDetailScreen canyonId={route.params.canyonId} />}
      </TripsStack.Screen>
    </TripsStack.Navigator>
  );
}

function TabIcon({
  name,
  color,
}: {
  name: React.ComponentProps<typeof Feather>["name"];
  color: string;
}) {
  return <Feather name={name} size={22} color={color} />;
}

// Foreground pushes show as banners; the inbox badge is refreshed on focus.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function AppShell({ onSignOut }: { onSignOut: () => void }) {
  const userQuery = useApiQuery(fetchCurrentUser, "Couldn't load your account.");
  const [consented, setConsented] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const navigationRef = useRef<NavigationContainerRef<never>>(null);

  // Register this device for pushes once authenticated (best-effort), and
  // route notification taps: a canyon reference deep-links to its detail,
  // everything else lands on the inbox. Payloads carry opaque IDs only — the
  // screen fetches details over the authed API.
  // Stage 8 sync triggers: initial cycle, app foreground, connectivity
  // regained. Torn down on sign-out (shell unmount).
  useEffect(() => registerSyncTriggers(), []);

  useEffect(() => {
    registerForPushNotifications();
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as {
          type?: string;
          canyonId?: string;
        };
        // The ref is untyped across nested navigators; runtime routes are
        // the tab/screen names registered below.
        const nav = navigationRef.current as unknown as {
          navigate: (name: string, params?: object) => void;
        } | null;
        if (!nav) return;
        if (typeof data.canyonId === "string") {
          nav.navigate("Canyons", {
            screen: "CanyonDetail",
            params: { canyonId: data.canyonId, name: "Canyon" },
          });
        } else {
          // Inbox now lives inside the More stack.
          nav.navigate("More", { screen: "Inbox" });
        }
      },
    );
    return () => subscription.remove();
  }, []);

  // Badge count prefers the notifications cache: it incorporates optimistic
  // (offline) mark-reads immediately and stays correct offline. Only when no
  // cache exists yet (first launch, inbox never opened) does it fall back to
  // the server count. Best-effort — the badge is decoration.
  const refreshUnread = useCallback(() => {
    getCachedUnreadCount()
      .then((cached) => {
        if (cached !== null) {
          setUnreadCount(cached);
          return;
        }
        return getUnreadNotificationCount().then(({ count }) => setUnreadCount(count));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    refreshUnread();
    // A cache patch (mark-read, offline included) fires notifyMirrorChanged;
    // recompute the badge from the cache so it drops immediately.
    return onMirrorChanged(refreshUnread);
  }, [refreshUnread]);

  if (userQuery.loading && !userQuery.data) return <LoadingState />;

  // Consent gate: block when we KNOW consent is stale. If the user fetch
  // failed (offline), proceed — never lock someone out of the app in the
  // field over an unreachable consent check.
  const user = userQuery.data;
  if (user && !consented && needsReconsent(user)) {
    return (
      <ConsentGate
        onConsented={() => {
          setConsented(true);
          userQuery.refetch();
        }}
        onSignOut={onSignOut}
      />
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <Tabs.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: theme.secondary, borderTopColor: theme.secondary },
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.textMuted,
        }}
      >
        <Tabs.Screen
          name="Map"
          options={{ tabBarIcon: ({ color }) => <TabIcon name="map" color={color} /> }}
        >
          {() => <MapStackNav />}
        </Tabs.Screen>
        <Tabs.Screen
          name="Canyons"
          options={{ tabBarIcon: ({ color }) => <TabIcon name="map-pin" color={color} /> }}
        >
          {() => <CanyonsStackNav />}
        </Tabs.Screen>
        <Tabs.Screen
          name="Logs"
          options={{ tabBarIcon: ({ color }) => <TabIcon name="book-open" color={color} /> }}
        >
          {() => <TripsStackNav />}
        </Tabs.Screen>
        <Tabs.Screen
          name="Saved"
          options={{ tabBarIcon: ({ color }) => <TabIcon name="download" color={color} /> }}
        >
          {() => <SavedStackNav />}
        </Tabs.Screen>
        <Tabs.Screen
          name="More"
          options={{
            tabBarIcon: ({ color }) => <TabIcon name="more-horizontal" color={color} />,
            ...(unreadCount ? { tabBarBadge: unreadCount } : {}),
          }}
        >
          {() => (
            <MoreStack.Navigator screenOptions={stackScreenOptions}>
              <MoreStack.Screen name="MoreHome" options={{ title: "More" }}>
                {({ navigation }) => (
                  <MoreScreen
                    unreadCount={unreadCount}
                    onOpenInbox={() => navigation.navigate("Inbox")}
                    onOpenAccount={() => navigation.navigate("Account")}
                    onOpenFriends={() => navigation.navigate("Friends")}
                    onOpenSyncIssues={() => navigation.navigate("SyncIssues")}
                    onOpenSettings={() => navigation.navigate("Settings")}
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen name="Inbox" options={{ title: "Inbox" }}>
                {() => <NotificationsScreen onUnreadChanged={refreshUnread} />}
              </MoreStack.Screen>
              <MoreStack.Screen name="Account" options={{ title: "Account" }}>
                {({ navigation }) => (
                  <AccountScreen
                    onSignOut={onSignOut}
                    onOpenSyncIssues={() => navigation.navigate("SyncIssues")}
                    onOpenFriends={() => navigation.navigate("Friends")}
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen
                name="Friends"
                component={FriendsScreen}
                options={{ title: "Friends" }}
              />
              <MoreStack.Screen
                name="SyncIssues"
                component={SyncIssuesScreen}
                options={{ title: "Sync issues" }}
              />
              <MoreStack.Screen
                name="Settings"
                component={SettingsScreen}
                options={{ title: "Settings" }}
              />
            </MoreStack.Navigator>
          )}
        </Tabs.Screen>
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
