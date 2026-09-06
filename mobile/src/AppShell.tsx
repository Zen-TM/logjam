// The app shell: bottom tabs (Map / Places / Logs / Saved / More) with native
// stacks for detail screens, behind the consent gate. The More tab is a hub
// folding Inbox, Account, Friends, Sync issues and Settings off the tab bar.
//
// Mounts for a GUEST as well as an authenticated user. Everything that talks to
// the server is registered conditionally below — a guest starts no sync engine,
// registers no push token, fetches no user record and runs no auto-download.
// Local storage is untouched by that distinction: guest mutations still write
// the mirror and still enqueue to the outbox, which is precisely what makes
// linking an account later a flush rather than a migration.
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  DarkTheme,
  NavigationContainer,
  type NavigationContainerRef,
} from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { isRouteEditing } from "./map/routeEditLock";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { isThemeSchemeId, needsReconsent } from "@logjam/shared";

import { fetchCurrentUser, getUnreadNotificationCount, useApiQuery } from "./api/queries";
import { AccountStateProvider } from "./auth/AccountStateContext";
import type { AccountState } from "./auth/capabilities";
import { getCachedUnreadCount } from "./sync/notificationsCache";
import { onMirrorChanged } from "./sync/syncDb";
import { registerSyncTriggers } from "./sync/syncEngine";
import { activeThemeSchemeId, persistThemeSchemeId, theme, withAlpha } from "./theme";
import { MapScreen } from "./map/MapScreen";
import { RegionDownloadScreen } from "./map/RegionDownloadScreen";
import type { BasemapId } from "./map/sourceResolver";
import { registerGeoPdfAutoDownload } from "./geopdf/autoDownload";
import { registerTopoAutoDownload } from "./offline/topoAutoDownload";
import { BackgroundToast } from "./BackgroundToast";
import { registerForPushNotifications } from "./notifications/pushRegistration";
import { notificationTapTarget } from "./notifications/tapTarget";
import { SavedScreen, type SavedItemReveal } from "./saved/SavedScreen";
import type { SavedCategory } from "./saved/savedKeys";
import { AccountScreen } from "./screens/AccountScreen";
import { PlaceDetailScreen } from "./places/PlaceDetailScreen";
import { PlacesScreen } from "./places/PlacesScreen";
import { PickPointScreen } from "./map/PickPointScreen";
import { PickAreaScreen } from "./map/PickAreaScreen";
import { readAreaPickerStart, setPickedArea } from "./map/pickedArea";
import { setPickedPoint } from "./map/pickedPoint";
import { ConsentGate } from "./screens/ConsentGate";
import { FriendsScreen } from "./screens/FriendsScreen";
import { FriendSharesScreen } from "./sharing/FriendSharesScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { SettingsScreen, type SettingsPage } from "./screens/SettingsScreen";
import { DisplaySettingsScreen } from "./screens/settings/DisplaySettingsScreen";
import { MapSettingsScreen } from "./screens/settings/MapSettingsScreen";
import { NotificationSettingsScreen } from "./screens/settings/NotificationSettingsScreen";
import { OfflineSettingsScreen } from "./screens/settings/OfflineSettingsScreen";
import { PrivacySettingsScreen } from "./screens/settings/PrivacySettingsScreen";
import { SyncIssuesScreen } from "./screens/SyncIssuesScreen";
import type { MirrorTrip } from "./sync/mirrorStore";
import { LogsScreen } from "./logs/LogsScreen";
import { TripDetailScreen } from "./logs/TripDetailScreen";
import { LoadingState } from "./ui/ScreenStates";

// Said in one place because it is said from two: the tab bar and the
// notification-response listener are both ways off the map, and two copies of
// this sentence would be two chances for them to drift apart.
function alertFinishRouteFirst(): void {
  Alert.alert(
    "Finish your route first",
    "Save it, or delete the draft, before leaving the map.",
    [{ text: "OK" }],
  );
}

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
  // `focus` = "show on map" from Saved, or the resolved extent of a trip's
  // route attachment (see MapScreen's `focus` prop): a bbox to fit on
  // arrival. Params only — never persisted or logged.
  MapView:
    | {
        focus?: {
          bbox: [number, number, number, number];
          nonce: number;
          /** Switch the map to this basemap on arrival — see SavedItem.focusBasemapId. */
          basemapId?: BasemapId;
          /** Which saved item this is, to toggle its layer on before flying. */
          reveal?: SavedItemReveal;
        };
        // `editRoute` = "Edit points" from Saved: arm the draw tool on an
        // existing route. An id, never geometry — the map reads the points
        // from the mirror it already has.
        editRoute?: { routeId: string; nonce: number };
        // `drawRouteFor` = "Draw one on the map": arm the pen. From a place
        // page it carries that place's id and saves into its route slot;
        // from Saved's add sheet the id is null and the route stands alone.
        drawRouteFor?: { placeId: string | null; nonce: number };
        // `continueTrack` = "Continue recording" from Saved: pick a finished
        // track back up. An id, never points.
        continueTrack?: { trackId: string; nonce: number };
        // `startRecording` = "Record a track" from Saved's add sheet.
        startRecording?: { nonce: number };
        // `navigatePlace` = "Navigate to this place" from a place's verbs. An id,
        // never a coordinate: navigation params are persisted and dumped by
        // devtools, and the map reads the point from the mirror it already has.
        navigatePlace?: { placeId: string; nonce: number };
      }
    | undefined;
  // Where the place form went to point at a map. A coordinate already in
  // the form arrives as params, with the id of the place being moved so the
  // picker can leave its own pin off; the answer goes back through
  // `pickedPoint.ts`.
  MapPickPoint:
    | { latitude: number; longitude: number; placeId?: string }
    | undefined;
  MapPlaceDetail: { placeId: string; name: string };
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

type PlacesStackParams = {
  PlaceList: undefined;
  PlaceDetail: { placeId: string; name: string };
  PlaceTripDetail: { trip: MirrorTrip };
  /**
   * The full-screen point picker for the add/edit form. Its ANSWER does not
   * come back through params — a place's coordinate must not be written into
   * navigation state, which persists and is dumped by devtools — it comes back
   * in memory through `places/pickedPoint.ts`. What travels here is only where
   * to open, which is a coordinate the user typed themselves and is on screen
   * in front of them.
   */
  PlacePickPoint: { latitude: number; longitude: number } | undefined;
  /**
   * The full-screen area picker for the place filter. NOTHING travels here —
   * not even where to open. A drawn box is a region of places, which is the
   * kind of value the point picker's params comment carves out an exception
   * AGAINST: both directions go through `map/pickedArea.ts` in memory.
   */
  PlacePickArea: undefined;
};

type TripsStackParams = {
  TripList: undefined;
  TripDetail: { trip: MirrorTrip };
  TripPlaceDetail: { placeId: string; name: string };
};

type SavedStackParams = {
  // `filter` lands the screen on one category — the map's layer sheet points
  // at the regions it manages, and "All" would make the user find them again.
  // `nonce` so following the same pointer twice re-selects it.
  // `highlightKey` names ONE row to pulse on arrival: the inbox's "View in
  // Saved" knows which item its notification was about, and a filter alone does
  // not answer "which of these forty".
  SavedHome:
    | { filter?: SavedCategory; nonce?: number; highlightKey?: string }
    | undefined;
  /**
   * The point picker for the "place from coordinates" form — the same screen
   * the Places stack registers, because a stack can only push its own routes
   * and the alternative is a cross-tab jump that leaves the form behind.
   * Coordinates travel IN only (where to open); the answer comes back in memory
   * through `map/pickedPoint.ts`.
   */
  SavedPickPoint:
    | { latitude: number; longitude: number; placeId?: string }
    | undefined;
};

type MoreStackParams = {
  MoreHome: undefined;
  Inbox: undefined;
  // Reached from a notification that refers to a place — pushed inside the
  // More stack so Back returns to the inbox, not to another tab's history.
  MorePlaceDetail: { placeId: string };
  MoreTripDetail: { trip: MirrorTrip };
  Account: undefined;
  Friends: undefined;
  // The per-friend sharing audit, pushed from a friend's overflow sheet. Params
  // rather than a fetch: the friendship id and the username are all the screen
  // needs, and both are already in the row that opened it.
  FriendShares: { friendshipId: string; username: string };
  SyncIssues: undefined;
  Settings: undefined;
  // Settings sub-pages. One route each rather than one parameterised route: a
  // native header wants its own title per screen, and the back stack reads
  // Settings › Map the way the user got there.
  SettingsDisplay: undefined;
  SettingsMap: undefined;
  SettingsNotifications: undefined;
  SettingsOffline: undefined;
  SettingsPrivacy: undefined;
};

/** Settings root → the route that page lives at. */
const SETTINGS_ROUTES: Record<SettingsPage, keyof MoreStackParams> = {
  display: "SettingsDisplay",
  map: "SettingsMap",
  notifications: "SettingsNotifications",
  offline: "SettingsOffline",
  privacy: "SettingsPrivacy",
};

const MapStack = createNativeStackNavigator<MapStackParams>();
const PlacesStack = createNativeStackNavigator<PlacesStackParams>();
const TripsStack = createNativeStackNavigator<TripsStackParams>();
const SavedStack = createNativeStackNavigator<SavedStackParams>();
const MoreStack = createNativeStackNavigator<MoreStackParams>();
const Tabs = createBottomTabNavigator();

/**
 * Map focus for one place — a tight box around its point (~1 km across), which
 * is what `MapView`'s `focus` param takes. Built at navigation time and never
 * stored: a region of interest stays off the server (mobile/CLAUDE.md).
 */
const PLACE_FOCUS_DEGREES = 0.005;
function placeFocus(place: { latitude: number; longitude: number }) {
  return {
    bbox: [
      place.longitude - PLACE_FOCUS_DEGREES,
      place.latitude - PLACE_FOCUS_DEGREES,
      place.longitude + PLACE_FOCUS_DEGREES,
      place.latitude + PLACE_FOCUS_DEGREES,
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
            onOpenPlace={(placeId, name) =>
              navigation.navigate("MapPlaceDetail", { placeId, name })
            }
            onOpenSaved={(category) =>
              navigation.getParent()?.navigate("Saved", {
                screen: "SavedHome",
                params: { filter: category, nonce: Date.now() },
              })
            }
            onSaveMapsOffline={(context) =>
              navigation.navigate("MapRegionDownload", context)
            }
            focus={route.params?.focus ?? null}
            editRoute={route.params?.editRoute ?? null}
            drawRouteFor={route.params?.drawRouteFor ?? null}
            continueTrack={route.params?.continueTrack ?? null}
            startRecording={route.params?.startRecording ?? null}
            navigatePlace={route.params?.navigatePlace ?? null}
            onPickPoint={(from, hidePlaceId) =>
              navigation.navigate(
                "MapPickPoint",
                from || hidePlaceId
                  ? { ...(from ?? undefined), placeId: hidePlaceId }
                  : undefined,
              )
            }
          />
        )}
      </MapStack.Screen>
      <MapStack.Screen name="MapPickPoint" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <PickPointScreen
            // A request that carries only a place id has no coordinate in it —
            // the form was blank — so the picker must open with no marker.
            initialPoint={
              route.params?.latitude != null && route.params?.longitude != null
                ? {
                    latitude: route.params.latitude,
                    longitude: route.params.longitude,
                  }
                : null
            }
            subject="place"
            hidePlaceId={route.params?.placeId ?? null}
            onCancel={() => navigation.goBack()}
            onConfirm={(point) => {
              setPickedPoint(point);
              navigation.goBack();
            }}
          />
        )}
      </MapStack.Screen>
      {/* Its own hero owns the back affordance (DESIGN.md §2). */}
      <MapStack.Screen name="MapRegionDownload" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <RegionDownloadScreen
            onBack={() => navigation.goBack()}
            // The download is already running by now: it reports as a card in
            // the Saved tab's Regions filter, which is also where it lives
            // once it lands.
            onStarted={() => {
              // Popped as well as left: without it, coming back to the Map tab
              // lands on the framing screen for an area already downloading.
              navigation.goBack();
              navigation.getParent()?.navigate("Saved", {
                screen: "SavedHome",
                params: { filter: "region", nonce: Date.now() },
              });
            }}
            initialBasemapId={route.params?.basemapId}
            initialCenter={route.params?.center}
            initialZoom={route.params?.zoom}
          />
        )}
      </MapStack.Screen>
      {/* Place and trip detail both carry their own HeroHeader, which owns the
          back affordance (DESIGN.md §2). */}
      <MapStack.Screen name="MapPlaceDetail" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <PlaceDetailScreen
            placeId={route.params.placeId}
            onBack={() => navigation.goBack()}
            onOpenTrip={(trip) => navigation.navigate("MapTripDetail", { trip })}
            onShowOnMap={(place) =>
              navigation.navigate("MapView", { focus: placeFocus(place) })
            }
            onFocusOnMap={(bbox) =>
              navigation.navigate("MapView", { focus: { bbox, nonce: Date.now() } })
            }
            onShowPlaceOnMap={(linked) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                // placeFocus, not a route bbox: a single point yields a
                // zero-span bbox, which the camera reads as "fit nothing".
                params: { focus: placeFocus(linked) },
              })
            }
            onDrawRoute={(id) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { drawRouteFor: { placeId: id, nonce: Date.now() } },
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
            onOpenPlace={(placeId, name) =>
              navigation.navigate("MapPlaceDetail", { placeId, name })
            }
            onFocusOnMap={(bbox) =>
              navigation.navigate("MapView", { focus: { bbox, nonce: Date.now() } })
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
            initialFilter={
              route.params?.filter
                ? { category: route.params.filter, nonce: route.params.nonce ?? 0 }
                : undefined
            }
            initialHighlight={
              route.params?.highlightKey
                ? { key: route.params.highlightKey, nonce: route.params.nonce ?? 0 }
                : undefined
            }
            onOpenMap={(bbox, basemapId, reveal) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: bbox
                  ? { focus: { bbox, nonce: Date.now(), basemapId, reveal } }
                  : undefined,
              })
            }
            // "Download a map region" used to drop the user on the map to find
            // the affordance themselves; it now opens the screen that does it.
            onDownloadRegion={() =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapRegionDownload",
              })
            }
            onEditRoute={(routeId) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { editRoute: { routeId, nonce: Date.now() } },
              })
            }
            onPickPoint={(from, hidePlaceId) =>
              navigation.navigate(
                "SavedPickPoint",
                from || hidePlaceId
                  ? { ...(from ?? undefined), placeId: hidePlaceId }
                  : undefined,
              )
            }
            // The recorder lives on the map, and so does the mode it puts the
            // app into — this hands the id over rather than arming it here.
            onContinueRecording={(trackId) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { continueTrack: { trackId, nonce: Date.now() } },
              })
            }
            // Both of these are made ON the map, so the add sheet hands the
            // request over rather than growing a second way to do it.
            onRecordTrack={() =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { startRecording: { nonce: Date.now() } },
              })
            }
            onDrawRoute={() =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { drawRouteFor: { placeId: null, nonce: Date.now() } },
              })
            }
            // The bearing line and the user dot are the map's, so this hands
            // the id over rather than growing a second navigator.
            // user there from here is a waypoint or route asking "which shared
            // place brought me?".
            onOpenPlace={(placeId, name) =>
              navigation.getParent()?.navigate("Places", {
                screen: "PlaceDetail",
                params: { placeId, name },
              })
            }
          />
        )}
      </SavedStack.Screen>
      <SavedStack.Screen name="SavedPickPoint" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <PickPointScreen
            // Same shape as the map stack's: a request may carry an id and no
            // coordinate (a blank form on an existing place), and that must
            // open with no marker rather than one at null island.
            initialPoint={
              route.params?.latitude != null && route.params?.longitude != null
                ? {
                    latitude: route.params.latitude,
                    longitude: route.params.longitude,
                  }
                : null
            }
            subject="place"
            hidePlaceId={route.params?.placeId ?? null}
            onCancel={() => navigation.goBack()}
            onConfirm={(point) => {
              setPickedPoint(point);
              navigation.goBack();
            }}
          />
        )}
      </SavedStack.Screen>
    </SavedStack.Navigator>
  );
}

function PlacesStackNav() {
  return (
    <PlacesStack.Navigator screenOptions={stackScreenOptions}>
      {/* No native header on any of these: each screen leads with its own
          HeroHeader (DESIGN.md §2). */}
      <PlacesStack.Screen name="PlaceList" options={{ headerShown: false }}>
        {({ navigation }) => (
          <PlacesScreen
            onOpenPlace={(place) =>
              navigation.navigate("PlaceDetail", { placeId: place.id, name: place.name })
            }
            onShowOnMap={(place) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { focus: placeFocus(place) },
              })
            }
            onPickPoint={(from) =>
              navigation.navigate("PlacePickPoint", from ?? undefined)
            }
            onPickArea={() => navigation.navigate("PlacePickArea")}
          />
        )}
      </PlacesStack.Screen>
      {/* Registered on the Places stack alone: the filter that opens it lives
          on the Places list, unlike the point picker, which three stacks
          reach. */}
      <PlacesStack.Screen name="PlacePickArea" options={{ headerShown: false }}>
        {({ navigation }) => (
          <PickAreaScreen
            initialArea={readAreaPickerStart()}
            onCancel={() => navigation.goBack()}
            onConfirm={(area) => {
              setPickedArea(area);
              navigation.goBack();
            }}
          />
        )}
      </PlacesStack.Screen>
      {/* The picker owns the whole screen — see PickPlacePointScreen for why
          it cannot be a mode of the sheet that opened it. */}
      <PlacesStack.Screen name="PlacePickPoint" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <PickPointScreen
            initialPoint={route.params ?? null}
            subject="place"
            onCancel={() => navigation.goBack()}
            onConfirm={(point) => {
              setPickedPoint(point);
              navigation.goBack();
            }}
          />
        )}
      </PlacesStack.Screen>
      <PlacesStack.Screen name="PlaceDetail" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <PlaceDetailScreen
            placeId={route.params.placeId}
            onBack={() => navigation.goBack()}
            onOpenTrip={(trip) => navigation.navigate("PlaceTripDetail", { trip })}
            onShowOnMap={(place) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { focus: placeFocus(place) },
              })
            }
            onFocusOnMap={(bbox) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { focus: { bbox, nonce: Date.now() } },
              })
            }
            onShowPlaceOnMap={(linked) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                // placeFocus, not a route bbox: a single point yields a
                // zero-span bbox, which the camera reads as "fit nothing".
                params: { focus: placeFocus(linked) },
              })
            }
            onDrawRoute={(id) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { drawRouteFor: { placeId: id, nonce: Date.now() } },
              })
            }
            onDeleted={() => navigation.goBack()}
          />
        )}
      </PlacesStack.Screen>
      <PlacesStack.Screen name="PlaceTripDetail" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <TripDetailScreen
            trip={route.params.trip}
            onBack={() => navigation.goBack()}
            onOpenPlace={(placeId, name) =>
              navigation.navigate("PlaceDetail", { placeId, name })
            }
            onFocusOnMap={(bbox) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { focus: { bbox, nonce: Date.now() } },
              })
            }
          />
        )}
      </PlacesStack.Screen>
    </PlacesStack.Navigator>
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
            onOpenPlace={(placeId, name) =>
              navigation.navigate("TripPlaceDetail", { placeId, name })
            }
            onFocusOnMap={(bbox) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { focus: { bbox, nonce: Date.now() } },
              })
            }
          />
        )}
      </TripsStack.Screen>
      <TripsStack.Screen name="TripPlaceDetail" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <PlaceDetailScreen
            placeId={route.params.placeId}
            onBack={() => navigation.goBack()}
            onOpenTrip={(trip) => navigation.navigate("TripDetail", { trip })}
            onShowOnMap={(place) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { focus: placeFocus(place) },
              })
            }
            onFocusOnMap={(bbox) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { focus: { bbox, nonce: Date.now() } },
              })
            }
            onShowPlaceOnMap={(linked) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                // placeFocus, not a route bbox: a single point yields a
                // zero-span bbox, which the camera reads as "fit nothing".
                params: { focus: placeFocus(linked) },
              })
            }
            onDrawRoute={(id) =>
              navigation.getParent()?.navigate("Map", {
                screen: "MapView",
                params: { drawRouteFor: { placeId: id, nonce: Date.now() } },
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

export function AppShell({
  accountState,
  onLinkAccount,
  onSignOut,
}: {
  accountState: AccountState;
  onLinkAccount: () => void;
  onSignOut: () => void;
}) {
  const isGuest = accountState === "guest";
  const userQuery = useApiQuery(
    fetchCurrentUser,
    "Couldn't load your account.",
    !isGuest,
  );
  const [consented, setConsented] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const navigationRef = useRef<NavigationContainerRef<never>>(null);

  // Register this device for pushes once authenticated (best-effort), and
  // route notification taps: a place reference deep-links to its detail,
  // everything else lands on the inbox. Payloads carry opaque IDs only — the
  // screen fetches details over the authed API.
  // Stage 8 sync triggers: initial cycle, app foreground, connectivity
  // regained. Torn down on sign-out (shell unmount).
  //
  // A guest registers none of them. This is the load-bearing half of guest
  // mode: without a cycle ever running, local mutations pile up in the outbox
  // exactly as they would offline, and the day an account is linked the first
  // cycle drains them. Registering triggers that could only ever 401 would
  // also mean a failing sync every foreground, and a permanently red sync
  // health line on the More tab.
  useEffect(() => {
    if (isGuest) return;
    return registerSyncTriggers();
  }, [isGuest]);

  // "Auto-download finished GeoPDFs" (Settings → Offline and storage): app
  // start, foreground, and connection regained — Wi-Fi by default. See
  // autoDownload.ts for why it checks then and not on a timer. GeoPDFs come
  // from the user's web account, so there is nothing to download for a guest.
  useEffect(() => {
    if (isGuest) return;
    return registerGeoPdfAutoDownload();
  }, [isGuest]);

  // The same feature over finished LiDAR topo overlays, on the same three
  // moments and the same guest rule. Its own registration rather than a shared
  // one: the two have separate switches and separate connection policies, and a
  // combined runner would make one's failure the other's.
  useEffect(() => {
    if (isGuest) return;
    return registerTopoAutoDownload();
  }, [isGuest]);

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
    // No account, no device row to register the push token against. The tap
    // listener still mounts — it costs nothing and keeps this effect's shape
    // identical either way.
    //
    // This registers the token only when notification permission is ALREADY
    // granted; it never prompts (MRUN-004 — Settings → Notifications asks).
    if (!isGuest) void registerForPushNotifications();
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        // The ref is untyped across nested navigators; runtime routes are
        // the tab/screen names registered below.
        const nav = navigationRef.current as unknown as {
          navigate: (name: string, params?: object) => void;
        } | null;
        if (!nav) return;
        // Where the tap goes — including the guard the tab bar applies, for the
        // same reason (MAPP-009). The precedence lives in
        // notifications/tapTarget, pure and tested, because this listener is
        // inside a component and nothing in mobile/ can run one.
        const target = notificationTapTarget({
          data: response.notification.request.content.data,
          routeEditing: isRouteEditing(),
        });
        if (target.kind === "blocked") {
          // With the Alert, so the tap is answered rather than silently ignored.
          alertFinishRouteFirst();
          return;
        }
        // A TAP DELIBERATELY DOES NOT MARK THE NOTIFICATION READ. It was built
        // that way once (the push carried the row's id for exactly that) and
        // reverted: a banner is a glance, often from a lock screen, and read
        // means "seen, nothing left to do here". The unread list is the queue of
        // things the user still has to deal with, and emptying it on the
        // strength of a tap-through takes rows out of the one list they are
        // looked for in. Opening the row is what reads it.
        if (target.kind === "place") {
          nav.navigate("Places", {
            screen: "PlaceDetail",
            params: { placeId: target.placeId, name: "Place" },
          });
        } else {
          // Inbox now lives inside the More stack.
          nav.navigate("More", { screen: "Inbox" });
        }
      },
    );
    return () => subscription.remove();
  }, [isGuest]);

  // Badge count prefers the notifications cache: it incorporates optimistic
  // (offline) mark-reads immediately and stays correct offline. Only when no
  // cache exists yet (first launch, inbox never opened) does it fall back to
  // the server count. Best-effort — the badge is decoration.
  //
  // A guest has no notifications at all, and the server fallback would be a
  // guaranteed-failing request on every mirror change.
  const refreshUnread = useCallback(() => {
    if (isGuest) return;
    getCachedUnreadCount()
      .then((cached) => {
        if (cached !== null) {
          setUnreadCount(cached);
          return;
        }
        return getUnreadNotificationCount().then(({ count }) => setUnreadCount(count));
      })
      .catch(console.error);
  }, [isGuest]);

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
  //
  // A guest passes through the same way an offline user does, and for a
  // stronger reason: consent is recorded ON the user record, so there is
  // nothing to be stale and nowhere to write an answer. The entry chooser
  // carries what a guest actually needs to agree to.
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
    <AccountStateProvider accountState={accountState} linkAccount={onLinkAccount}>
    {/* The background toast is a SIBLING of the whole navigator: a GeoPDF
        import and a region download both run in the background and can finish
        on any tab, so their outcome has no screen of its own to be announced
        from. */}
    <View style={{ flex: 1 }}>
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <Tabs.Navigator
        // A route being drawn or edited owns the map's taps and has no home
        // anywhere else, so the tab bar refuses to take you off it. The draft
        // does survive (routeDraftStore), but nothing on another tab says so —
        // leaving would read as losing the route.
        screenListeners={{
          tabPress: (event) => {
            if (!isRouteEditing()) return;
            const target = event.target ?? "";
            if (target.startsWith("Map")) return;
            event.preventDefault();
            alertFinishRouteFirst();
          },
        }}
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: theme.secondary,
            borderTopColor: withAlpha(theme.textPrimary, 0.25),
            borderTopWidth: 1,
          },
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
          name="Places"
          options={{ tabBarIcon: ({ color }) => <TabIcon name="map-pin" color={color} /> }}
        >
          {() => <PlacesStackNav />}
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
                    // A share notification is a way in to the place it is
                    // about; the name is unknown here, so the detail screen
                    // resolves it from the id over the authed API.
                    onOpenPlace={(placeId) =>
                      navigation.navigate("MorePlaceDetail", { placeId })
                    }
                    // A notification about a saved item is a way in to that
                    // item: the Saved tab, on its filter, with the row pulsed.
                    // The filter alone when the notification names the thing
                    // but not the row (see notificationDestination.ts).
                    onOpenSaved={(filter, highlightKey) =>
                      navigation.getParent()?.navigate("Saved", {
                        screen: "SavedHome",
                        params: {
                          filter,
                          nonce: Date.now(),
                          ...(highlightKey ? { highlightKey } : {}),
                        },
                      })
                    }
                    // Pushed INSIDE the More stack, like the place above, so
                    // Back returns to the inbox rather than to another tab.
                    onOpenFriends={() => navigation.navigate("Friends")}
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen name="MorePlaceDetail" options={{ headerShown: false }}>
                {({ navigation, route }) => (
                  <PlaceDetailScreen
                    placeId={route.params.placeId}
                    onBack={() => navigation.goBack()}
                    onOpenTrip={(trip) => navigation.navigate("MoreTripDetail", { trip })}
                    onShowOnMap={(place) =>
                      navigation.getParent()?.navigate("Map", {
                        screen: "MapView",
                        params: { focus: placeFocus(place) },
                      })
                    }
                    onFocusOnMap={(bbox) =>
                      navigation.getParent()?.navigate("Map", {
                        screen: "MapView",
                        params: { focus: { bbox, nonce: Date.now() } },
                      })
                    }
                    onShowPlaceOnMap={(linked) =>
                      navigation.getParent()?.navigate("Map", {
                        screen: "MapView",
                        // placeFocus, not a route bbox: a single point
                        // yields a zero-span bbox, which the camera reads as
                        // "fit nothing".
                        params: { focus: placeFocus(linked) },
                      })
                    }
                    onDrawRoute={(id) =>
                      navigation.getParent()?.navigate("Map", {
                        screen: "MapView",
                        params: { drawRouteFor: { placeId: id, nonce: Date.now() } },
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
                    onOpenPlace={(placeId) =>
                      navigation.navigate("MorePlaceDetail", { placeId })
                    }
                    onFocusOnMap={(bbox) =>
                      navigation.getParent()?.navigate("Map", {
                        screen: "MapView",
                        params: { focus: { bbox, nonce: Date.now() } },
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
                {({ navigation }) => (
                  <FriendsScreen
                    onBack={() => navigation.goBack()}
                    onOpenShares={(friend) => navigation.navigate("FriendShares", friend)}
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen name="FriendShares" options={{ headerShown: false }}>
                {({ navigation, route }) => (
                  <FriendSharesScreen
                    friendshipId={route.params.friendshipId}
                    username={route.params.username}
                    onBack={() => navigation.goBack()}
                    // Inside the More stack, like the inbox's own place route,
                    // so Back returns to the sharing list.
                    onOpenPlace={(placeId) =>
                      navigation.navigate("MorePlaceDetail", { placeId })
                    }
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen name="SyncIssues" options={{ headerShown: false }}>
                {({ navigation }) => (
                  <SyncIssuesScreen
                    onBack={() => navigation.goBack()}
                    // A stuck change is a way IN to the thing it failed on: the
                    // permanent-failure sheet offers "open it and change it a
                    // way that works". Pushed inside the More stack, like the
                    // inbox's own place route, so Back returns to the issue.
                    onOpenPlace={(placeId) =>
                      navigation.navigate("MorePlaceDetail", { placeId })
                    }
                    onOpenTrip={(trip) => navigation.navigate("MoreTripDetail", { trip })}
                  />
                )}
              </MoreStack.Screen>
              {/* Settings and its sub-pages are plain preference lists, so they
                  keep the native header and its back button (DESIGN.md §2). */}
              <MoreStack.Screen name="Settings" options={{ title: "Settings" }}>
                {({ navigation }) => (
                  <SettingsScreen
                    onOpenPage={(page) => navigation.navigate(SETTINGS_ROUTES[page])}
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen
                name="SettingsDisplay"
                component={DisplaySettingsScreen}
                options={{ title: "Display" }}
              />
              <MoreStack.Screen
                name="SettingsMap"
                component={MapSettingsScreen}
                options={{ title: "Map" }}
              />
              <MoreStack.Screen
                name="SettingsNotifications"
                component={NotificationSettingsScreen}
                options={{ title: "Notifications" }}
              />
              <MoreStack.Screen name="SettingsOffline" options={{ title: "Offline and storage" }}>
                {({ navigation }) => (
                  <OfflineSettingsScreen
                    onOpenSaved={() =>
                      navigation.getParent()?.navigate("Saved", { screen: "SavedHome" })
                    }
                  />
                )}
              </MoreStack.Screen>
              <MoreStack.Screen
                name="SettingsPrivacy"
                component={PrivacySettingsScreen}
                options={{ title: "Privacy and security" }}
              />
            </MoreStack.Navigator>
          )}
        </Tabs.Screen>
      </Tabs.Navigator>
    </NavigationContainer>
    <BackgroundToast />
    </View>
    </AccountStateProvider>
  );
}
