// Authenticated app shell: bottom tabs (Canyons / Trips / Inbox / Account)
// with native stacks for detail screens, behind the consent gate.
import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "react-native";
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
import type { TTripLog } from "./api/types";
import { registerSyncTriggers } from "./sync/syncEngine";
import { theme } from "./theme";
import { MapScreen } from "./map/MapScreen";
import { registerForPushNotifications } from "./notifications/pushRegistration";
import { AccountScreen } from "./screens/AccountScreen";
import { CanyonDetailScreen } from "./screens/CanyonDetailScreen";
import { CanyonsScreen } from "./screens/CanyonsScreen";
import { ConsentGate } from "./screens/ConsentGate";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { TripDetailScreen, TripsScreen } from "./screens/TripsScreen";
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
  MapView: undefined;
  MapCanyonDetail: { canyonId: string; name: string };
};

type CanyonsStackParams = {
  CanyonList: undefined;
  CanyonDetail: { canyonId: string; name: string };
};

type TripsStackParams = {
  TripList: undefined;
  TripDetail: { trip: TTripLog };
};

const MapStack = createNativeStackNavigator<MapStackParams>();
const CanyonsStack = createNativeStackNavigator<CanyonsStackParams>();
const TripsStack = createNativeStackNavigator<TripsStackParams>();
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
        {({ navigation }) => (
          <MapScreen
            onOpenCanyon={(canyonId, name) =>
              navigation.navigate("MapCanyonDetail", { canyonId, name })
            }
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
      <TripsStack.Screen name="TripList" options={{ title: "Trips" }}>
        {({ navigation }) => (
          <TripsScreen onOpenTrip={(trip) => navigation.navigate("TripDetail", { trip })} />
        )}
      </TripsStack.Screen>
      <TripsStack.Screen name="TripDetail" options={{ title: "Trip" }}>
        {({ route }) => <TripDetailScreen trip={route.params.trip} />}
      </TripsStack.Screen>
    </TripsStack.Navigator>
  );
}

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  // Placeholder glyph icons until an icon set lands with the design pass.
  return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
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
          nav.navigate("Inbox");
        }
      },
    );
    return () => subscription.remove();
  }, []);

  const refreshUnread = useCallback(() => {
    getUnreadNotificationCount()
      .then(({ count }) => setUnreadCount(count))
      // Best-effort: the badge is decoration; the inbox itself surfaces errors.
      .catch(console.error);
  }, []);

  useEffect(() => {
    refreshUnread();
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
          options={{ tabBarIcon: ({ color }) => <TabIcon glyph="◈" color={color} /> }}
        >
          {() => <MapStackNav />}
        </Tabs.Screen>
        <Tabs.Screen
          name="Canyons"
          options={{ tabBarIcon: ({ color }) => <TabIcon glyph="▲" color={color} /> }}
        >
          {() => <CanyonsStackNav />}
        </Tabs.Screen>
        <Tabs.Screen
          name="Trips"
          options={{ tabBarIcon: ({ color }) => <TabIcon glyph="≋" color={color} /> }}
        >
          {() => <TripsStackNav />}
        </Tabs.Screen>
        <Tabs.Screen
          name="Inbox"
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: theme.secondary },
            headerTintColor: theme.textPrimary,
            tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} />,
            ...(unreadCount ? { tabBarBadge: unreadCount } : {}),
          }}
        >
          {() => <NotificationsScreen onUnreadChanged={refreshUnread} />}
        </Tabs.Screen>
        <Tabs.Screen
          name="Account"
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: theme.secondary },
            headerTintColor: theme.textPrimary,
            tabBarIcon: ({ color }) => <TabIcon glyph="●" color={color} />,
          }}
        >
          {() => <AccountScreen onSignOut={onSignOut} />}
        </Tabs.Screen>
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
