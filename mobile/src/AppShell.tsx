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
import { isThemeSchemeId, needsReconsent } from "@logjam/shared";

import { fetchCurrentUser, getUnreadNotificationCount, useApiQuery } from "./api/queries";
import { getCachedUnreadCount } from "./sync/notificationsCache";
import { onMirrorChanged } from "./sync/syncDb";
import { registerSyncTriggers } from "./sync/syncEngine";
import { activeThemeSchemeId, persistThemeSchemeId, theme } from "./theme";
import { MapScreen } from "./map/MapScreen";
import { RegionDownloadScreen } from "./map/RegionDownloadScreen";
import type { BasemapId } from "./map/sourceResolver";
import { registerGeoPdfAutoDownload } from "./geopdf/autoDownload";
import { registerForPushNotifications } from "./notifications/pushRegistration";
import { SavedScreen } from "./saved/SavedScreen";
import { AccountScreen } from "./screens/AccountScreen";
import { CanyonDetailScreen } from "./canyons/CanyonDetailScreen";
import { CanyonsScreen } from "./canyons/CanyonsScreen";
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
  // MapScreen's `focus` prop). `route` = a trip's route attachment to draw
  // transiently. Params only — never persisted or logged.
  MapView:
    | {
        focus?: { bbox: [number, number, number, number]; nonce: number };
        route?: {
          mediaId: string;
          filename: string;
          localPath?: string | null;
          nonce: number;
        };
      }
    | undefined;
  MapCanyonDetail: { canyonId: string; name: string };
  MapTripDetail: { trip: MirrorTrip };
  // Where the map was looking when "Save maps for offline use" was tapped, so
  // the download screen opens on the same ground. Params only, never persisted.
  MapRegionDownload:
    | {
        basemapId: BasemapId;
        center: [number, number];
        zoom: number;
      }
    | undefined;
};

type CanyonsStackParams = {
  CanyonList: undefined;
  CanyonDetail: { canyonId: string; name: string };
  CanyonTripDetail: { trip: MirrorTrip };
};

type TripsStackParams = {
  TripList: undefined;
  TripDetail: { trip: MirrorTrip };
  TripCanyonDetail: { canyonId: string; name: string };
};

type SavedStackParams = {
  // `filter` lands the screen on one category — the map's layer sheet points
  // at the regions it manages, and "All" would make the user find them again.
  SavedHome: { filter?: "region" } | undefined;
};

type MoreStackParams = {
  MoreHome: undefined;
  Inbox: undefined;
  // Reached from a notification that refers to a canyon — pushed inside the
  // More stack so Back returns to the inbox, not to another tab's history.
  MoreCanyonDetail: { canyonId: string };
  MoreTripDetail: { trip: MirrorTrip };
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

/**
 * Map focus for one canyon — a tight box around its point (~1 km across), which
 * is what `MapView`'s `focus` param takes. Built at navigation time and never
 * stored: a region of interest stays off the server (mobile/CLAUDE.md).
 */
const CANYON_FOCUS_DEGREES = 0.005;
function canyonFocus(canyon: { latitude: number; longitude: number }) {
  return {
    bbox: [
      canyon.longitude - CANYON_FOCUS_DEGREES,
      canyon.latitude - CANYON_FOCUS_DEGREES,
      canyon.longitude + CANYON_FOCUS_DEGREES,
      canyon.latitude + CANYON_FOCUS_DEGREES,
    ] as [number, number, number, number],
    nonce: Date.now(),
  };
}

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
            onOpenSaved={(category) =>
              navigation.getParent()?.navigate("Saved", {
                screen: "SavedHome",
                params: { filter: category },
              })
            }
            onSaveMapsOffline={(context) =>
              navigation.navigate("MapRegionDownload", context)
            }
            focus={route.params?.focus ?? null}
            route={route.params?.route ?? null}
          />
        )}
      </MapStack.Screen>
      {/* Its own hero owns the back affordance (DESIGN.md §2). */}
      <MapStack.Screen name="MapRegionDownload" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <RegionDownloadScreen
            onBack={() => navigation.goBack()}
            initialBasemapId={route.params?.basemapId}
            initialCenter={route.params?.center}
            initialZoom={route.params?.zoom}
          />
        )}
      </MapStack.Screen>
      {/* Canyon and trip detail both carry their own HeroHeader, which owns the
          back affordance (DESIGN.md §2). */}
      <MapStack.Screen name="MapCanyonDetail" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <CanyonDetailScreen
            canyonId={route.params.canyonId}
            onBack={() => navigation.goBack()}
            onOpenTrip={(trip) => navigation.navigate("MapTripDetail", { trip })}
            onShowOnMap={(canyon) =>
              navigation.navigate("MapView", { focus: canyonFocus(canyon) })
            }
            onShowRoute={(mediaId, filename, localPath) =>
              navigation.navigate("MapView", {
                route: { mediaId, filename, localPath, nonce: Date.now() },
              })
            }
            onDeleted={() => navigation.goBack()}
          />
        )}
      </MapStack.Screen>
      <MapStack.Screen name="MapTripDetail" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <TripDetailScreen
            trip={route.params.trip}
            onBack={() => navigation.goBack()}
            onOpenCanyon={(canyonId, name) =>
              navigation.navigate("MapCanyonDetail", { canyonId, name })
            }
            onShowRoute={(mediaId, filename, localPath) =>
              navigation.navigate("MapView", {
                route: { mediaId, filename, localPath, nonce: Date.now() },
              })
            }
          />
        )}
      </MapStack.Screen>
    </MapStack.Navigator>
  );
}

function SavedStackNav() {
  return (
    <SavedStack.Navigator screenOptions={stackScreenOptions}>
      {/* No native header: SavedScreen leads with its own HeroHeader. */}
      <SavedStack.Screen name="SavedHome" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <SavedScreen
            initialFilter={route.params?.filter}
            onOpenMap={(bbox) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: bbox ? { focus: { bbox, nonce: Date.now() } } : undefined,
              })
            }
            // "Download a map region" used to drop the user on the map to find
            // the affordance themselves; it now opens the screen that does it.
            onDownloadRegion={() =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapRegionDownload",
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
      {/* No native header on any of these: each screen leads with its own
          HeroHeader (DESIGN.md §2). */}
      <CanyonsStack.Screen name="CanyonList" options={{ headerShown: false }}>
        {({ navigation }) => (
          <CanyonsScreen
            onOpenCanyon={(canyon) =>
              navigation.navigate("CanyonDetail", { canyonId: canyon.id, name: canyon.name })
            }
            onShowOnMap={(canyon) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { focus: canyonFocus(canyon) },
              })
            }
            onPickOnMap={() =>
              navigation.getParent()?.navigate("Map", { screen: "MapView" })
            }
          />
        )}
      </CanyonsStack.Screen>
      <CanyonsStack.Screen name="CanyonDetail" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <CanyonDetailScreen
            canyonId={route.params.canyonId}
            onBack={() => navigation.goBack()}
            onOpenTrip={(trip) => navigation.navigate("CanyonTripDetail", { trip })}
            onShowOnMap={(canyon) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { focus: canyonFocus(canyon) },
              })
            }
            onShowRoute={(mediaId, filename, localPath) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { route: { mediaId, filename, localPath, nonce: Date.now() } },
              })
            }
            onDeleted={() => navigation.goBack()}
          />
        )}
      </CanyonsStack.Screen>
      <CanyonsStack.Screen name="CanyonTripDetail" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <TripDetailScreen
            trip={route.params.trip}
            onBack={() => navigation.goBack()}
            onOpenCanyon={(canyonId, name) =>
              navigation.navigate("CanyonDetail", { canyonId, name })
            }
            onShowRoute={(mediaId, filename, localPath) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { route: { mediaId, filename, localPath, nonce: Date.now() } },
              })
            }
          />
        )}
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
            onShowRoute={(mediaId, filename, localPath) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { route: { mediaId, filename, localPath, nonce: Date.now() } },
              })
            }
          />
        )}
      </TripsStack.Screen>
      <TripsStack.Screen name="TripCanyonDetail" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <CanyonDetailScreen
            canyonId={route.params.canyonId}
            onBack={() => navigation.goBack()}
            onOpenTrip={(trip) => navigation.navigate("TripDetail", { trip })}
            onShowOnMap={(canyon) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { focus: canyonFocus(canyon) },
              })
            }
            onShowRoute={(mediaId, filename, localPath) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { route: { mediaId, filename, localPath, nonce: Date.now() } },
              })
            }
            onDeleted={() => navigation.goBack()}
          />
        )}
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

  // "Auto-download finished GeoPDFs" (Settings → Downloads): app start,
  // foreground, and connection regained — Wi-Fi only. See autoDownload.ts for
  // why it checks then and not on a timer.
  useEffect(() => registerGeoPdfAutoDownload(), []);

  // Mirror the account's theme choice onto this device, so a scheme picked in the
  // browser (or on another phone) is what this app opens in next launch. The
  // device copy is what `theme.ts` reads at module-eval time; see DESIGN.md §12.
  useEffect(() => {
    const accountScheme = userQuery.data?.uiPreferences?.themeSchemeId;
    if (isThemeSchemeId(accountScheme) && accountScheme !== activeThemeSchemeId) {
      persistThemeSchemeId(accountScheme);
    }
  }, [userQuery.data?.uiPreferences?.themeSchemeId]);

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
              {/* Every screen here except Settings leads with its own
                  HeroHeader, which owns the back affordance (DESIGN.md §2).
                  Settings is a plain settings list, so it keeps the native
                  header — the rule that a bare-label hero is the pattern being
                  replaced cuts both ways. */}
              <MoreStack.Screen name="MoreHome" options={{ headerShown: false }}>
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
              <MoreStack.Screen name="Inbox" options={{ headerShown: false }}>
                {({ navigation }) => (
                  <NotificationsScreen
                    onBack={() => navigation.goBack()}
                    onUnreadChanged={refreshUnread}
                    // A share notification is a way in to the canyon it is
                    // about; the name is unknown here, so the detail screen
                    // resolves it from the id over the authed API.
                    onOpenCanyon={(canyonId) =>
                      navigation.navigate("MoreCanyonDetail", { canyonId })
                    }
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen name="MoreCanyonDetail" options={{ headerShown: false }}>
                {({ navigation, route }) => (
                  <CanyonDetailScreen
                    canyonId={route.params.canyonId}
                    onBack={() => navigation.goBack()}
                    onOpenTrip={(trip) => navigation.navigate("MoreTripDetail", { trip })}
                    onShowOnMap={(canyon) =>
                      navigation.getParent()?.navigate("Map", {
                        screen: "MapView",
                        params: { focus: canyonFocus(canyon) },
                      })
                    }
                    onShowRoute={(mediaId, filename, localPath) =>
                      navigation.getParent()?.navigate("Map", {
                        screen: "MapView",
                        params: { route: { mediaId, filename, localPath, nonce: Date.now() } },
                      })
                    }
                    onDeleted={() => navigation.goBack()}
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen name="MoreTripDetail" options={{ headerShown: false }}>
                {({ navigation, route }) => (
                  <TripDetailScreen
                    trip={route.params.trip}
                    onBack={() => navigation.goBack()}
                    onOpenCanyon={(canyonId) =>
                      navigation.navigate("MoreCanyonDetail", { canyonId })
                    }
                    onShowRoute={(mediaId, filename, localPath) =>
                      navigation.getParent()?.navigate("Map", {
                        screen: "MapView",
                        params: { route: { mediaId, filename, localPath, nonce: Date.now() } },
                      })
                    }
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen name="Account" options={{ headerShown: false }}>
                {({ navigation }) => (
                  <AccountScreen
                    onBack={() => navigation.goBack()}
                    onSignOut={onSignOut}
                    onOpenFriends={() => navigation.navigate("Friends")}
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen name="Friends" options={{ headerShown: false }}>
                {({ navigation }) => <FriendsScreen onBack={() => navigation.goBack()} />}
              </MoreStack.Screen>
              <MoreStack.Screen name="SyncIssues" options={{ headerShown: false }}>
                {({ navigation }) => <SyncIssuesScreen onBack={() => navigation.goBack()} />}
              </MoreStack.Screen>
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
