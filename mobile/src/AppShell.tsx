// Authenticated app shell: bottom tabs (Canyons / Trips / Inbox / Account)
// with native stacks for detail screens, behind the consent gate.
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { needsReconsent } from "@logjam/shared";

import { fetchCurrentUser, getUnreadNotificationCount, useApiQuery } from "./api/queries";
import type { TTripLog } from "./api/types";
import { theme } from "./theme";
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

type CanyonsStackParams = {
  CanyonList: undefined;
  CanyonDetail: { canyonId: string; name: string };
};

type TripsStackParams = {
  TripList: undefined;
  TripDetail: { trip: TTripLog };
};

const CanyonsStack = createNativeStackNavigator<CanyonsStackParams>();
const TripsStack = createNativeStackNavigator<TripsStackParams>();
const Tabs = createBottomTabNavigator();

const stackScreenOptions = {
  headerStyle: { backgroundColor: theme.secondary },
  headerTintColor: theme.textPrimary,
  contentStyle: { backgroundColor: theme.primary },
} as const;

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

export function AppShell({ onSignOut }: { onSignOut: () => void }) {
  const userQuery = useApiQuery(fetchCurrentUser, "Couldn't load your account.");
  const [consented, setConsented] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

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
    <NavigationContainer theme={navigationTheme}>
      <Tabs.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: theme.secondary, borderTopColor: theme.secondary },
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.textMuted,
        }}
      >
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
