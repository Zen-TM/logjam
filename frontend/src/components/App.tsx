import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import NavRail from "./sidebar/NavRail";
import SidebarPanel from "./sidebar/SidebarPanel";
import Map, { BASE_LAYERS, type SnapMode } from "./map/Map";
import { useRouteDraft } from "./routes/useRouteDraft";
import SignIn from "./SignIn";
import BrandMark from "./brand/BrandMark";
import TopoDialog from "./dialogs/TopoDialog";
import type {
  TopoJob,
  GeoJsonPolygonal,
  DownloadUrl,
} from "./dialogs/TopoDialog";
import GeoPdfDialog from "./dialogs/GeoPdfDialog";
import type { GeoPdfTemplate } from "./dialogs/GeoPdfDialog";
import PlaceDialog from "./dialogs/PlaceDialog";
import UnifiedImportDialog from "./dialogs/UnifiedImportDialog";
import OnboardingChoiceDialog from "./dialogs/OnboardingChoiceDialog";
import SelectedPlacesDialog from "./dialogs/SelectedPlacesDialog";
import classes from "./App.module.css";
import type { TBbox } from "./map/Map";
import { createPlaceHighlight } from "./map/placeHighlight";
import type { TFilters, TPlace, TPlaceType, GeoPdfJobView } from "../placeUtils";
import type { ScopedCustomFieldDef, StandaloneFile } from "@logjam/shared";
import { PANEL_TITLES, type LogsView, type MapsView, type PanelId } from "./sidebar/panels";
import { TOPO_LAYERS } from "../topoLayerTypes";
import type { CompletedTopoJob, CompletedOverlaysResponse } from "../topoLayerTypes";
import {
  usePlaces,
  usePlaceTracks,
  useStandaloneFiles,
  useStandaloneTracks,
  deleteMedia,
  useRoutes,
  type TRoute,
  createRoute,
  updateRoute,
  useSharedPlaces,
  useFriends,
  useNotifications,
  useTripLogs,
  useCurrentUser,
  useLiveVectorStyle,
  useTopoExports,
  useGeoPdfJobs,
  fetchCurrentUser,
  getCustomFields,
  getPlaceTypes,
  recordConsent,
  passesFilters,
  hasActiveFilters,
  emptyFilters,
  reconcileCustomFilters,
  apiFetch,
  getTopoExport,
} from "../placeUtils";
import LayersPopover from "./map/LayersPopover";
import type { MapTool } from "./map/MapChrome";
import type { MapKind } from "./sidebar/panels/PlacesPanel";
import { Button, IconButton, MapButton, Notice } from "../ui";
import {
  FileText,
  Filter,
  Layers,
  MapPinPlus,
  Mountain,
  PenTool,
  SquareDashed,
  X,
} from "lucide-react";
import {
  CURRENT_CONSENT_VERSION,
  PENDING_CONSENT_STORAGE_KEY,
  consentGate,
  needsReconsent,
} from "../consent";
import ConsentGate from "./ConsentGate";
import { RouteDrawPanel } from "./routes/RouteDrawPanel";
import RouteNameDialog from "./dialogs/RouteNameDialog";
import WayDetailPanel from "./sidebar/panels/WayDetailPanel";
import { buildWays, wayFromRoute, type WayItem } from "./sidebar/panels/waysModel";
import { createRouteHoverChannel } from "./map/routeHover";
import type { WayVerbId } from "./sidebar/panels/wayActions";
import ConfirmDialog from "./dialogs/ConfirmDialog";
import { useUnsavedChangesGuard } from "../useUnsavedChangesGuard";
import {
  TOPO_OVERLAY_SOURCE,
  GEOPDF_OVERLAY_ATTRIBUTION,
  pickNextTrackColor,
} from "@logjam/shared";
import type { OverlaySource } from "@logjam/shared";
import { useAuth } from "../useAuth";
import { useStoredState } from "../useStoredState";
import { useThemePreferences } from "../themePreferences";
import { useToast } from "./feedback/ToastProvider";
import { messageFromError } from "../errors/messageFromError";
import { triggerDownload } from "../download";

function App() {
  const toast = useToast();
  // Session-scoped, like the search box beside it: every member of TFilters
  // hides places, and a filter the user set last month greets them as "my
  // places are missing" rather than as a favour (UX finding 5). The search box
  // moved for that reason while this — grades, ownership, completion, dates,
  // custom fields, the larger hider — was left on localStorage. Same principle,
  // same polarity. Sort order is the counter-example and stays in localStorage:
  // it reorders, it never hides. Survives the panel's unmount-on-close
  // (PLACE-12) without surviving the week.
  const [storedFilters, setFilters] = useStoredState<TFilters>(
    "logjam.filters",
    emptyFilters,
    sessionStorage,
  );
  // Declared here (not with the other field-def state below) because the filters
  // memo needs it to prune custom filters whose definition no longer exists.
  // SCOPED: each definition carries the place types it appears on, because a
  // form built without that renders a canyon's grades on a campsite. Read from
  // the row-grain endpoint rather than the /users/me projection, which is the
  // plain shape kept for legacy readers.
  const [placeCustomFieldDefs, setPlaceCustomFieldDefs] = useState<
    ScopedCustomFieldDef[]
  >([]);
  // Backfill defaults for any filter keys missing from older persisted state, so
  // new fields (ownership, ropewiki, date ranges, custom) never read as undefined,
  // then drop custom-field filters orphaned by a since-deleted definition.
  const filters = useMemo<TFilters>(
    () =>
      reconcileCustomFilters(
        { ...emptyFilters, ...storedFilters },
        placeCustomFieldDefs,
      ),
    [storedFilters, placeCustomFieldDefs],
  );
  const [openFiltersRequested, setOpenFiltersRequested] = useState(false);
  const consumeOpenFilters = useCallback(() => setOpenFiltersRequested(false), []);
  const [selectedPlaceID, setSelectedPlaceID] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  // Which view the two-view pages open on — remembered for the session, so a
  // return to Logs lands where the user left it.
  const [logsView, setLogsView] = useStoredState<LogsView>("logjam.logsView", "logs", sessionStorage);
  const [mapsView, setMapsView] = useStoredState<MapsView>("logjam.mapsView", "geopdfs", sessionStorage);
  // What is on the map is a popover over the map, not a page.
  const [layersOpen, setLayersOpen] = useState(false);
  const layersButtonRef = useRef<HTMLButtonElement>(null);
  // Vector by default: same OSM cartography as the old raster default, drawn
  // locally rather than fetched as pictures, and it carries the labels at every
  // zoom instead of stopping where the raster cache does.
  const [storedLayerId, setActiveLayerId] = useStoredState(
    "logjam.activeLayerId",
    "protomaps",
  );
  // A basemap the picker no longer offers (the raster "Default", dropped for
  // the vector one) would otherwise hide every basemap layer and show nothing.
  const activeLayerId = BASE_LAYERS.some((layer) => layer.id === storedLayerId)
    ? storedLayerId
    : "protomaps";

  const [showAdd, setShowAdd] = useState(false);
  const [showUnifiedImport, setShowUnifiedImport] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // True when the unified importer was opened from the onboarding wizard, so its
  // Back/close returns to the welcome hub instead of dropping into an empty app.
  const [importedFromOnboarding, setImportedFromOnboarding] = useState(false);
  const importChecked = useRef(false);

  // What is drawn on the map. TWO overlays over the user's own data, divided by
  // what a thing IS — a pin is a place, a line is a way — so nothing belongs to
  // both and no toggle overlaps another (LayersPopover carries the reasoning).
  //
  // NEW KEYS, not the old four reused: those answered different questions, and
  // a stored `false` for "shared ways" arriving as "hide every line I have"
  // would silently empty the map of someone who had only ever hidden a friend's.
  const [showPlaces, setShowPlaces] = useStoredState("logjam.showPlaces", true);
  const [showWays, setShowWays] = useStoredState("logjam.showWays", true);

  // Route draw/edit mode. The vertex list lives here (not in Map) so the HUD
  // can show the running distance and drive undo. `editingRouteId` is null
  // while drawing a new route.
  const [drawingRoute, setDrawingRoute] = useState(false);
  const [drawColor, setDrawColor] = useState<string | null>(null);
  const routeDraft = useRouteDraft();
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [savingRoute, setSavingRoute] = useState(false);
  const [namingRoute, setNamingRoute] = useState(false);
  // Persisted: a canyoner who wants creek-following wants it every session.
  const [snapMode, setSnapMode] = useStoredState<SnapMode>(
    "logjam.snapMode",
    "off",
  );
  // The way whose page is open. The WAY rather than a route id: every kind has
  // a page now, and a recorded track or an imported file is not a route.
  const [selectedWay, setSelectedWay] = useState<WayItem | null>(null);
  // A verb a ROW asked for, run once the way's page mounts — how a row offers
  // Share, Rename and Delete without hosting a second copy of each form.
  const [pendingWayVerb, setPendingWayVerb] = useState<WayVerbId | null>(null);
  // A way's extent, for the map to fit. Consumed, not counted (DESIGN.md §9).
  // A tuple, as `WayItem.bounds` and MapLibre's `fitBounds` both are — not the
  // `RegionBbox` object the topo flows pass around.
  const [flyToBounds, setFlyToBounds] = useState<[number, number, number, number] | null>(null);
  // Where along a line the elevation-profile cursor sits, so the chart and the
  // map point at the same place. NOT state: it changes many times a second, and
  // as state every move re-rendered App, the map and the panel before the dot
  // could move (DESIGN.md §9 — `map/routeHover.ts` carries the full reasoning).
  const routeHover = useMemo(createRouteHoverChannel, []);

  // Coordinate picking mode for PlaceDialog
  const [pickingCoords, setPickingCoords] = useState(false);
  const coordsCallbackRef = useRef<((lat: number, lng: number) => void) | null>(
    null,
  );

  /**
   * The Places filter's "area on map" mode: the panel closes, the user draws a
   * box, and it lands in the filter.
   */
  const [selectingFilterArea, setSelectingFilterArea] = useState(false);
  // The places handed to the share-and-export dialog.
  const [selectedAreaPlaceIds, setSelectedAreaPlaceIds] = useState<string[]>(
    [],
  );
  // Page ↔ map: a sheet beside the list pushes the map's chrome over and the
  // row under the pointer lights its pin. Any page's sheet, not just
  // Places': a page is unmounted when it closes and `usePanelSheet` clears this
  // on the way out, so the panel it belongs to never needs naming here — naming
  // it is what left Logs' date sheet out (operator, 2026-09-16).
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);
  const [placeHighlight] = useState(createPlaceHighlight);

  // Topo dialog
  const [showTopo, setShowTopo] = useState(false);
  const [selectingTopoBbox, setSelectingTopoBbox] = useState(false);
  const [pendingTopoBbox, setPendingTopoBbox] = useState<TBbox | null>(null);
  // Topo job tracking (lifted from TopoDialog so polling survives dialog close)
  const [activeTopoJobs, setActiveTopoJobs] = useState<TopoJob[]>([]);
  const [topoFlyTarget, setTopoFlyTarget] = useState<GeoJsonPolygonal | null>(
    null,
  );
  // All of the user's completed topo jobs (with presigned PMTiles URLs per
  // layer). Replaces the old single "master" mosaic — each job is its own
  // set of overlays, controlled per-job in the Overlays panel.
  const [completedTopoJobs, setCompletedTopoJobs] = useState<
    CompletedTopoJob[]
  >([]);
  // True once the first fetch settles, either way: an empty list before then is
  // not "no topos yet" (DESIGN.md §8).
  const [completedTopoJobsLoaded, setCompletedTopoJobsLoaded] = useState(false);
  // Topo overlay entries (`${jobId}-${layerName}`) whose PMTiles source failed
  // to load this session (e.g. output files gone from S3). Drives the
  // "unavailable" badge in the Layers panel (LAYERS-1).
  const [unavailableTopoEntryIds, setUnavailableTopoEntryIds] = useState<
    Set<string>
  >(new Set());
  // One toast for the whole session, however many sources fail.
  const topoUnavailableToastShownRef = useRef(false);

  // GeoPDF dialog
  const [showGeoPdf, setShowGeoPdf] = useState(false);
  const [selectingGeoPdfExtent, setSelectingGeoPdfExtent] = useState(false);
  const [geoPdfPaperAspect, setGeoPdfPaperAspect] = useState(210 / 297);
  const [geoPdfPaperDimensions, setGeoPdfPaperDimensions] = useState<{
    w: number;
    h: number;
  }>({ w: 210, h: 297 });
  const [geoPdfInitialExtent, setGeoPdfInitialExtent] = useState<
    TBbox | undefined
  >(undefined);
  const [geoPdfInitialScale, setGeoPdfInitialScale] = useState<
    number | undefined
  >(undefined);
  const [pendingGeoPdfExtent, setPendingGeoPdfExtent] = useState<TBbox | null>(
    null,
  );
  const [pendingGeoPdfScale, setPendingGeoPdfScale] = useState<number | null>(
    null,
  );

  // Map view state — persisted for session restore and used for GeoPDF initialisation
  const [mapCenter, setMapCenter] = useStoredState<{
    lat: number;
    lng: number;
    zoom: number;
    bearing: number;
    pitch: number;
  } | null>("logjam.mapView", null);

  // GeoPDF template editing state (undefined = normal mode, null = new template, object = edit)
  const [editingGeoPdfTemplate, setEditingGeoPdfTemplate] = useState<
    GeoPdfTemplate | null | undefined
  >(undefined);
  // ID to pre-select when opening GeoPdfDialog in normal mode
  const [initialGeoPdfTemplateId, setInitialGeoPdfTemplateId] = useState<string | null>(null);
  // Bumped after template save/delete to trigger panel refetch
  const [geoPdfTemplateRefetch, setGeoPdfTemplateRefetch] = useState(0);

  // Bumped when a GeoPDF job is queued, to trigger the panel's job list refetch
  const [geoPdfJobsRefetch, setGeoPdfJobsRefetch] = useState(0);

  // Topo template: ID to pre-select when opening TopoDialog
  const [initialTopoTemplateId, setInitialTopoTemplateId] = useState<string | null>(null);

  // Bumped when TopoDialog saves a template inline, so LidarPanel's template
  // list refreshes without waiting for an accordion re-open (TOPO-1)
  const [topoTemplateRefetch, setTopoTemplateRefetch] = useState(0);

  // Place fly-to target
  const [flyToPlace, setFlyToPlace] = useState<{ lat: number; lng: number } | null>(null);

  // LiDAR topo panel state — lifted so it persists across panel open/close
  const [lidarEnabled, setLidarEnabled] = useStoredState("logjam.lidarEnabled", false);

  const currentLayerNames: string[] = TOPO_LAYERS.map((l) => l.name);
  const defaultLayerToggles = Object.fromEntries(currentLayerNames.map((n) => [n, true]));
  const [rawLidarLayerToggles, setLidarLayerToggles] = useStoredState<Record<string, boolean>>(
    "logjam.lidarLayerToggles",
    defaultLayerToggles,
  );
  // Drop unknown layers, add missing new layers as true
  const lidarLayerToggles: Record<string, boolean> = {
    ...defaultLayerToggles,
    ...Object.fromEntries(
      Object.entries(rawLidarLayerToggles).filter(([k]) => currentLayerNames.includes(k)),
    ),
  };

  const [rawLidarLayerOrder, setLidarLayerOrder] = useStoredState<string[]>(
    "logjam.lidarLayerOrder",
    currentLayerNames,
  );
  // Drop unknown names, append any new layers at end
  const lidarLayerOrder: string[] = [
    ...rawLidarLayerOrder.filter((n) => currentLayerNames.includes(n)),
    ...currentLayerNames.filter((n) => !rawLidarLayerOrder.includes(n)),
  ];

  // Per-completed-job visibility. Newly fetched jobs default to true (visible).
  const [lidarJobToggles, setLidarJobToggles] = useStoredState<Record<string, boolean>>(
    "logjam.lidarJobToggles",
    {},
  );

  // Compose all (job × layer) pairs into the flat list the Map consumes.
  // Z-order: outer loop = layer (per user-chosen order), inner loop = jobs
  // (newest first so newer data renders on top of older within the same layer).
  // A pair is included only when both the layer toggle and the job toggle are on.
  const combinedTopoLayers = useMemo(() => {
    if (!lidarEnabled) return [];
    const out: {
      id: string;
      pmtilesUrl: string;
      format?: "raster" | "vector";
      attribution?: string;
    }[] = [];
    for (const layerName of lidarLayerOrder) {
      if (!lidarLayerToggles[layerName]) continue;
      // Credit the overlay's open-data source (ELVIS / SVTM / OSM) so MapLibre's
      // AttributionControl surfaces the required CC BY / ODbL attribution.
      // A layer may credit more than one source (e.g. vegetation density is a
      // LiDAR CHM, so it credits both elevation and the SVTM vegetation source).
      // layerName comes from persisted user state (string), so index the
      // TopoLayerName-keyed record defensively rather than crash on a stale
      // stored name.
      const overlaySources =
        (TOPO_OVERLAY_SOURCE as Record<string, OverlaySource[] | undefined>)[
          layerName
        ] ?? [];
      const attribution = overlaySources.length
        ? overlaySources.map((s) => GEOPDF_OVERLAY_ATTRIBUTION[s]).join(" · ")
        : undefined;
      for (const job of completedTopoJobs) {
        if (!(lidarJobToggles[job.jobId] ?? true)) continue;
        const match = job.layers.find((l) => l.name === layerName);
        if (!match) continue;
        out.push({
          id: `${job.jobId}-${layerName}`,
          pmtilesUrl: match.pmtilesUrl,
          format: match.format,
          attribution,
        });
      }
    }
    return out;
  }, [
    lidarEnabled,
    lidarLayerOrder,
    lidarLayerToggles,
    lidarJobToggles,
    completedTopoJobs,
  ]);

  // A topo overlay's PMTiles source failed to load (Map already tore it down
  // to stop the retry spam). Record it for the Layers-panel badge and tell the
  // user once — silently missing layers were the LAYERS-1 finding.
  const handleTopoSourceUnavailable = useCallback(
    (entryId: string) => {
      setUnavailableTopoEntryIds((prev) => {
        if (prev.has(entryId)) return prev;
        const next = new Set(prev);
        next.add(entryId);
        return next;
      });
      if (!topoUnavailableToastShownRef.current) {
        topoUnavailableToastShownRef.current = true;
        toast.error(
          "Some LiDAR topo layers couldn't be loaded — their map files are missing. Affected layers are marked in the Layers panel.",
        );
      }
    },
    [toast],
  );

  // Layer names with at least one failed source, for the Layers-panel badge.
  const unavailableTopoLayerNames = useMemo(() => {
    const names = new Set<string>();
    if (unavailableTopoEntryIds.size === 0) return names;
    for (const job of completedTopoJobs) {
      for (const layer of job.layers) {
        if (unavailableTopoEntryIds.has(`${job.jobId}-${layer.name}`)) {
          names.add(layer.name);
        }
      }
    }
    return names;
  }, [completedTopoJobs, unavailableTopoEntryIds]);

  const startPickingCoords = useCallback(
    (onPicked: (lat: number, lng: number) => void) => {
      coordsCallbackRef.current = onPicked;
      setPickingCoords(true);
    },
    [],
  );

  const handleCoordsPicked = useCallback((lat: number, lng: number) => {
    coordsCallbackRef.current?.(lat, lng);
    coordsCallbackRef.current = null;
    setPickingCoords(false);
  }, []);

  const cancelPickingCoords = useCallback(() => {
    coordsCallbackRef.current = null;
    setPickingCoords(false);
  }, []);

  /**
   * The map's visible bounds, kept in a ref rather than in state: "Filter to
   * the current view" reads them once, when the button is pressed, and putting
   * them in state would re-render the app on every pan for a value nothing
   * renders.
   */
  const mapBoundsRef = useRef<TBbox | null>(null);
  // The same bounds as state, for the Layers popover's "In this view". Set on
  // moveend only, so it re-renders once per gesture rather than per frame.
  const [mapBounds, setMapBounds] = useState<TBbox | null>(null);

  const startFilterAreaSelection = useCallback(() => {
    setActivePanel(null);
    setSelectingFilterArea(true);
  }, []);

  const cancelFilterAreaSelection = useCallback(() => {
    setSelectingFilterArea(false);
  }, []);

  // Reflect the active panel in the document title (WCAG 2.4.2 Page Titled).
  useEffect(() => {
    document.title = activePanel ? `${PANEL_TITLES[activePanel]} — Logjam Web` : "Logjam Web";
  }, [activePanel]);

  // When switching away from place-detail via NavRail, clear selectedPlaceID
  const handlePanelChange = useCallback((panel: PanelId | null) => {
    if (panel !== "place-detail") {
      setSelectedPlaceID(null);
    }
    setActivePanel(panel);
  }, []);

  // When closing the panel
  const handlePanelClose = useCallback(() => {
    if (activePanel === "place-detail") {
      setSelectedPlaceID(null);
    }
    setActivePanel(null);
  }, [activePanel]);

  const auth = useAuth();
  const authenticated = auth.state === "authenticated";
  const { hydrateFromUser } = useThemePreferences();
  const { currentUser, refetchCurrentUser, applyCurrentUser } = useCurrentUser(authenticated);
  // FECO-005. `authenticated` is NOT enough to start fetching the user's data:
  // a user whose recorded consent is stale gets ConsentGate rendered instead of
  // the app, but rendering is all that used to stop — every hook and boot
  // effect below still pulled their places, trips, friends and notifications
  // out of the API behind the gate. `loadsUserData` is what they wait on now.
  //
  // `useCurrentUser` above and `useAuth` are the two that cannot: they are how
  // the answer arrives. Everything downstream of them gates on this instead.
  // The localStorage read is deliberately unmemoised — it is a string compare,
  // and the key is removed in the boot effect below, whose `applyCurrentUser`
  // re-render is what re-reads it.
  const { blocked: consentBlocked, settled: consentSettled } = consentGate(
    currentUser,
    localStorage.getItem(PENDING_CONSENT_STORAGE_KEY),
  );
  const loadsUserData = authenticated && consentSettled;
  const { places, total: placesTotal, loaded: placesLoaded, error: placesError, refetch } = usePlaces(loadsUserData);
  const { places: sharedPlaces, error: sharedError, refetch: refetchShared } =
    useSharedPlaces(loadsUserData);
  // Also fetched for the Routes panel, which lists the same track files.
  const {
    tracks: placeTracks,
    loaded: placeTracksLoaded,
    refetch: refetchPlaceTracks,
  } = usePlaceTracks(
    // Every line is drawn by "Ways", wherever it came from — a friend's place's
    // tracks included.
    loadsUserData && (showWays || activePanel === "ways"),
  );
  // Standalone files: the user's own imports and Logjam GPS recordings. They
  // hang off no place, so Ways is the only page they surface on.
  //
  // The "Ways" OVERLAY draws them now. It used to be a switch on each file's
  // own detail page — a per-item control you had to open a page to find, and
  // one that could never answer "show me my lines" (operator, 2026-09-17).
  // Presigned URLs are still minted only for what is actually drawn, so the
  // egress gate on POST /media/download-urls is unchanged; it is the overlay
  // that opens it now rather than a switch per row.
  const {
    files: standaloneFiles,
    loaded: standaloneFilesLoaded,
    error: standaloneFilesError,
    refetch: refetchStandaloneFiles,
  } = useStandaloneFiles(loadsUserData && (activePanel === "ways" || showWays));
  const shownStandaloneIds = useMemo(
    () => (showWays ? standaloneFiles.map((file) => file.id) : []),
    [showWays, standaloneFiles],
  );
  const { tracks: standaloneTracks } = useStandaloneTracks(
    standaloneFiles,
    shownStandaloneIds,
  );

  const handleDeleteStandaloneFile = useCallback(
    async (file: StandaloneFile) => {
      try {
        await deleteMedia(file.id);
        // Nothing to prune: what is drawn is DERIVED from the file list now, so
        // the refetch below is what takes a deleted file off the map.
        refetchStandaloneFiles();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete that file."));
      }
    },
    [refetchStandaloneFiles, toast],
  );

  // Routes load whenever the layer is on OR a draw/edit session is live (the
  // editor needs the row it is editing even with the layer toggled off).
  const { routes, loaded: routesLoaded, refetch: refetchRoutes } = useRoutes(
    loadsUserData && (showWays || drawingRoute || activePanel === "ways"),
  );

  // Ways is built from three fetches, so it has nothing to say until all three
  // have settled — one still in flight would show a short list as if it were
  // the whole list (DESIGN.md §8).
  const waysLoaded = routesLoaded && standaloneFilesLoaded && placeTracksLoaded;

  /** The places shared WITH the user. What tells a route shared on its own from
   *  one seen through somebody's place, which decides the verbs it offers. */
  const sharedPlaceIds = useMemo(
    () => new Set(sharedPlaces.map((place) => place.id)),
    [sharedPlaces],
  );

  // The overlay's count is the SAME list the Ways page builds — including its
  // de-duplication of a file that both endpoints return — so the number on the
  // layer row and the number in the page's heading cannot drift.
  const wayCount = useMemo(
    () =>
      buildWays({
        routes,
        standaloneFiles,
        placeTracks,
        currentUserId: currentUser?.id ?? null,
        sharedPlaceIds,
      }).length,
    [routes, standaloneFiles, placeTracks, currentUser?.id, sharedPlaceIds],
  );

  // A place list change (e.g. after a track upload) should refresh the layer.
  useEffect(() => {
    if (showWays) refetchPlaceTracks();
  }, [places, sharedPlaces, showWays, refetchPlaceTracks]);
  const {
    friends,
    requests: friendRequests,
    error: friendsError,
    refetch: refetchFriends,
  } = useFriends(loadsUserData);
  const {
    notifications,
    total: notificationsTotal,
    loaded: notificationsLoaded,
    unreadCount,
    error: notificationsError,
    refetch: refetchNotifications,
    overrideRead: overrideNotificationRead,
  } = useNotifications(loadsUserData);
  const {
    tripLogs,
    total: tripLogsTotal,
    loaded: tripLogsLoaded,
    error: tripLogsError,
    refetch: refetchTripLogs,
  } = useTripLogs(loadsUserData);
  // Every trip write also moves place state, not just trip state: a place's
  // map marker is green iff `_count.tripLogLinks > 0` (isPlaceDoneByViewer),
  // and that tally is computed server-side on the OWNED place list. Nothing in
  // the client can maintain it locally without duplicating the server's join —
  // a trip links many places, an edit can add and remove links in one save, and
  // a delete drops all of them — so the honest refresh is to re-pull the list
  // the count came from. Every trip create/edit/delete/import already funnels
  // through onRefetchTripLogs, so pairing the two here covers all of them at
  // once (and any site added later) instead of at each call site.
  const refetchAfterTripWrite = useCallback(() => {
    refetchTripLogs();
    refetch();
  }, [refetchTripLogs, refetch]);
  const {
    vectorStyle,
    setVectorStyle: setLiveVectorStyle,
    saveError: vectorStyleSaveError,
  } = useLiveVectorStyle(loadsUserData);

  // Trip-log definitions, read from the same row-grain endpoint as the place
  // ones. A trip field carries scoping too (§2.7 scopes a trip's fields by the
  // types of the places it links), and reading both the same way means one
  // shape reaches every dialog instead of two.
  const [customFieldDefs, setCustomFieldDefs] = useState<
    ScopedCustomFieldDef[]
  >([]);
  // The types a place can be filed under. ALL of them, including empty ones:
  // the tab bar and the layers list hide a type with no places, but the create
  // dialog must offer every one or a user could never make their first canyon.
  const [placeTypes, setPlaceTypes] = useState<TPlaceType[]>([]);

  // Surface background data-load errors as toasts
  useEffect(() => { if (placesError) toast.error(placesError); }, [placesError, toast]);
  useEffect(() => { if (sharedError) toast.error(sharedError); }, [sharedError, toast]);
  useEffect(() => { if (friendsError) toast.error(friendsError); }, [friendsError, toast]);
  useEffect(() => { if (notificationsError) toast.error(notificationsError); }, [notificationsError, toast]);
  useEffect(() => { if (tripLogsError) toast.error(tripLogsError); }, [tripLogsError, toast]);
  useEffect(() => { if (vectorStyleSaveError) toast.error(vectorStyleSaveError); }, [vectorStyleSaveError, toast]);

  useEffect(() => {
    if (!authenticated) return;
    // Best-effort: hydration prefetch for the map/sidebar; UI degrades
    // gracefully (panels show their own empty/error states) if this fails.
    hydrateFromUser().catch(console.error);
    // The place definitions come from the row-grain endpoint because only it
    // carries the scoping. Best-effort: a failure leaves the forms with the
    // built-in fields alone, and the panels show their own error states.
    getCustomFields("place").then(setPlaceCustomFieldDefs).catch(console.error);
    getCustomFields("trip-log").then(setCustomFieldDefs).catch(console.error);
    getPlaceTypes().then(setPlaceTypes).catch(console.error);
    fetchCurrentUser()
      .then((user) => {

        // Record the consent given on the sign-up form. Only a pending value
        // matching the current version is recordable (the server 400s any
        // other), and only while the user's stored version is actually stale —
        // this also covers a stale-version user who re-signed-up, which the
        // old `!user.consentedAt` check silently skipped.
        const pending = localStorage.getItem(PENDING_CONSENT_STORAGE_KEY);
        if (pending === CURRENT_CONSENT_VERSION && needsReconsent(user)) {
          recordConsent(pending)
            .then((updated) => {
              // Sync the cached user before dropping the pending key so the
              // ConsentGate never flashes for a fresh sign-up.
              applyCurrentUser(updated);
              localStorage.removeItem(PENDING_CONSENT_STORAGE_KEY);
            })
            .catch((err) => {
              console.error(err);
              toast.error(messageFromError(err, "Couldn't record your consent. It will be retried next time you sign in."));
            });
        } else if (pending) {
          localStorage.removeItem(PENDING_CONSENT_STORAGE_KEY);
        }
      })
      .catch((err) => { console.error(err); toast.error(messageFromError(err, "Couldn't load your preferences.")); });
  }, [authenticated, hydrateFromUser, toast, applyCurrentUser]);

  // Resume tracking any jobs that were pending/processing before page load
  useEffect(() => {
    if (!loadsUserData) return;
    apiFetch<TopoJob[]>("/topo-jobs")
      .then((jobs) => {
        const resumable = jobs.filter(
          (j) =>
            (j.status === "pending" || j.status === "processing") &&
            // Only the caller's OWN jobs resume here: a job shared WITH the
            // user is read-only and its row must never land in the active-jobs
            // ribbon (whose Dismiss/delete is owner-only).
            j.syncRole === "owner",
        );
        if (resumable.length) setActiveTopoJobs(resumable);
      })
      // Best-effort: if this fails, in-progress jobs simply won't resume
      // polling until the next page load — non-critical background refresh.
      .catch((err) => { console.error(err); });
  }, [loadsUserData]);

  // Fetch the user's completed topo jobs (with presigned PMTiles URLs) on
  // auth and whenever a job transitions to complete.
  const [overlaysExpiresAt, setOverlaysExpiresAt] = useState<string | null>(null);
  const refetchCompletedTopoJobs = useCallback(() => {
    return apiFetch<CompletedOverlaysResponse>("/topo-jobs/completed-overlays")
      .then(({ jobs, expiresAt }) => {
        setCompletedTopoJobs(jobs);
        setOverlaysExpiresAt(expiresAt);
        setLidarJobToggles((prev) => {
          // Default newly-seen jobs to visible; preserve prior toggle state
          // for jobs we already knew about.
          const next: Record<string, boolean> = { ...prev };
          for (const j of jobs) {
            if (next[j.jobId] === undefined) next[j.jobId] = true;
          }
          return next;
        });
      })
      // Best-effort: called again on the next poll tick / job completion,
      // so a transient failure here is non-critical.
      .catch((err) => { console.error(err); })
      .finally(() => setCompletedTopoJobsLoaded(true));
  }, []);

  useEffect(() => {
    if (!loadsUserData) return;
    refetchCompletedTopoJobs();
  }, [loadsUserData, refetchCompletedTopoJobs]);

  // Pre-refetch presigned PMTiles URLs ~30 min before the server-reported expiry
  // so MapLibre tile requests never see a 403 in an active session.
  useEffect(() => {
    if (!loadsUserData || !overlaysExpiresAt) return;
    const refetchAt = new Date(overlaysExpiresAt).getTime() - 30 * 60 * 1000;
    const delay = refetchAt - Date.now();
    if (delay <= 0) {
      refetchCompletedTopoJobs();
      return;
    }
    const timer = setTimeout(() => { refetchCompletedTopoJobs(); }, delay);
    return () => clearTimeout(timer);
  }, [loadsUserData, overlaysExpiresAt, refetchCompletedTopoJobs]);

  // Topo exports (Stage 2 on-demand pipeline). Owned at App level so the
  // recent-exports list (rendered in the LiDAR panel accordion) and the
  // auto-download on completion work regardless of which panel or dialog is
  // open. The hook self-throttles: it only polls while an export is in
  // progress.
  const {
    exports: topoExports,
    total: topoExportsTotal,
    loading: topoExportsLoading,
    refetch: refetchTopoExports,
  } = useTopoExports(loadsUserData);

  // GeoPDF jobs are also polled here (in addition to the sidebar panel) so
  // auto-download works even when the Generated PDFs panel is closed. The hook
  // self-throttles: it only polls while a job is queued/running.
  const { jobs: geoPdfJobs, refetch: refetchGeoPdfJobs } = useGeoPdfJobs(loadsUserData);

  // Auto-download exports that complete during this session. Snapshot the
  // exports already completed on first successful fetch so we never download a
  // pre-existing export, and never download the same one twice.
  const alreadyCompletedExportIds = useRef<Set<string>>(new Set());
  const autoDownloadedExportIds = useRef<Set<string>>(new Set());
  const exportSnapshotTaken = useRef(false);
  // The hook returns exports=[] synchronously before its first fetch resolves.
  // Snapshotting that empty list would mark a real, pre-existing completed
  // export as "new" once the fetch lands, auto-downloading it on every page
  // load. Gate the snapshot until a fetch has actually completed.
  const exportFetchResolved = useRef(false);
  useEffect(() => {
    if (!authenticated) {
      exportSnapshotTaken.current = false;
      exportFetchResolved.current = false;
      alreadyCompletedExportIds.current = new Set();
      autoDownloadedExportIds.current = new Set();
      return;
    }
    if (topoExportsLoading) {
      exportFetchResolved.current = true;
      return;
    }
    // Not loading, but no fetch has resolved yet → this is the initial empty
    // list, not real data. Wait for the first real fetch.
    if (!exportFetchResolved.current) return;
    if (!exportSnapshotTaken.current) {
      for (const ex of topoExports) {
        if (ex.status === "completed") alreadyCompletedExportIds.current.add(ex.id);
      }
      exportSnapshotTaken.current = true;
      return;
    }
    for (const ex of topoExports) {
      if (
        ex.status === "completed" &&
        ex.downloadUrl &&
        !alreadyCompletedExportIds.current.has(ex.id) &&
        !autoDownloadedExportIds.current.has(ex.id)
      ) {
        autoDownloadedExportIds.current.add(ex.id);
        triggerDownload(ex.downloadUrl);
      }
    }
  }, [authenticated, topoExports, topoExportsLoading]);

  // Auto-download GeoPDFs that this tab queued during this session. Arming is
  // in-memory only: a job id is added to armedGeoPdfJobIds when queued here, and
  // the ref is empty on a fresh load, so pre-existing completed jobs returned by
  // GET /geo-pdf are never armed and never auto-download (the new-browser bug).
  const armedGeoPdfJobIds = useRef<Set<string>>(new Set());
  const autoDownloadedGeoPdfJobIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const job of geoPdfJobs) {
      if (!armedGeoPdfJobIds.current.has(job.id)) continue;
      if (job.status === "failed") {
        armedGeoPdfJobIds.current.delete(job.id);
        continue;
      }
      if (
        job.status === "completed" &&
        job.downloadUrl &&
        !autoDownloadedGeoPdfJobIds.current.has(job.id)
      ) {
        autoDownloadedGeoPdfJobIds.current.add(job.id);
        armedGeoPdfJobIds.current.delete(job.id);
        triggerDownload(job.downloadUrl);
        toast.success("GeoPDF downloaded.");
      }
    }
  }, [geoPdfJobs, toast]);

  // Poll non-terminal jobs every 10 s; fire snackbar on completion
  useEffect(() => {
    const nonTerminal = activeTopoJobs.filter(
      (j) => j.status !== "complete" && j.status !== "failed",
    );
    if (!nonTerminal.length) return;
    const interval = setInterval(async () => {
      for (const job of nonTerminal) {
        try {
          const updated = await apiFetch<TopoJob>(`/topo-jobs/${job.id}`);
          setActiveTopoJobs((prev) =>
            prev.map((j) => (j.id === updated.id ? updated : j)),
          );
          if (updated.status === "complete") {
            setActiveTopoJobs((prev) =>
              prev.filter((j) => j.id !== updated.id),
            );
            refetchNotifications();
            refetchCompletedTopoJobs();
          }
        } catch (err) {
          console.error(`Topo job poll failed for ${job.id}:`, err);
          // transient — will retry next tick
        }
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [activeTopoJobs, refetchNotifications, refetchCompletedTopoJobs]);

  const handleTopoJobCreated = useCallback((job: TopoJob) => {
    // Register for active-job polling. The dialog owns the success surface
    // (in-dialog "Submitted" view) and its own close, so no toast/close here.
    setActiveTopoJobs((prev) => [job, ...prev]);
  }, []);

  // Durable delete replaces the old hide-only dismiss so failed rows can't
  // linger invisibly (DELETE /topo-jobs/:id handles failed rows + S3 cleanup
  // + quota). On failure the row stays visible so the user can retry.
  const handleDismissActiveTopoJob = useCallback(
    async (jobId: string) => {
      try {
        await apiFetch(`/topo-jobs/${jobId}`, { method: "DELETE" });
        setActiveTopoJobs((prev) => prev.filter((j) => j.id !== jobId));
        refetchCurrentUser();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't dismiss job."));
      }
    },
    [refetchCurrentUser, toast],
  );

  const handleGeoPdfJobQueued = useCallback((job: GeoPdfJobView) => {
    setGeoPdfJobsRefetch((n) => n + 1);
    // Arm for auto-download if the user hasn't disabled it (default on).
    if (currentUser?.uiPreferences?.autoDownloadGeoPdfs ?? true) {
      armedGeoPdfJobIds.current.add(job.id);
    }
    // Kick the App-level poller so it picks up the freshly queued job and starts
    // polling toward completion (the panel may be closed).
    refetchGeoPdfJobs();
  }, [currentUser, refetchGeoPdfJobs]);

  // Capture completion-email deep links on mount (?topoJob / ?export /
  // ?geoPdfJob), stash in sessionStorage so they survive a Cognito sign-in
  // redirect, then clean the URL once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let matched = false;
    const topoJobId = params.get("topoJob");
    if (topoJobId) {
      const layer = params.get("download");
      sessionStorage.setItem("pendingTopoJobId", topoJobId);
      if (layer) sessionStorage.setItem("pendingTopoDownload", layer);
      matched = true;
    }
    const exportId = params.get("export");
    if (exportId) {
      sessionStorage.setItem("pendingExportId", exportId);
      matched = true;
    }
    const geoPdfJobId = params.get("geoPdfJob");
    if (geoPdfJobId) {
      sessionStorage.setItem("pendingGeoPdfJobId", geoPdfJobId);
      matched = true;
    }
    if (matched) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // After auth, resolve any stashed deep-link job.
  // With ?download=<layer>: fetch presigned URL for that layer and trigger download.
  // Without ?download: open TopoDialog (existing behaviour).
  useEffect(() => {
    if (!loadsUserData) return;
    const jobId = sessionStorage.getItem("pendingTopoJobId");
    if (!jobId) return;
    sessionStorage.removeItem("pendingTopoJobId");
    const layer = sessionStorage.getItem("pendingTopoDownload");
    if (layer) sessionStorage.removeItem("pendingTopoDownload");

    if (layer) {
      apiFetch<DownloadUrl[]>(`/topo-jobs/${jobId}/download-urls`)
        .then((urls) => {
          const entry = urls.find((u) => u.name === layer);
          if (!entry) {
            toast.error(`Download layer "${layer}" not found for this job.`);
            return;
          }
          const a = document.createElement("a");
          a.href = entry.mbtilesUrl;
          a.download = `${entry.name}.mbtiles`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        })
        .catch((err) => {
          console.error(err);
          toast.error(messageFromError(err, "Couldn't start download."));
        });
    } else {
      apiFetch<TopoJob>(`/topo-jobs/${jobId}`)
        .then((job) => {
          setActiveTopoJobs((prev) =>
            prev.some((j) => j.id === job.id) ? prev : [job, ...prev],
          );
          setShowTopo(true);
        })
        .catch((err) => {
          console.error(err);
          toast.error(messageFromError(err, "Couldn't load topo job."));
        });
    }
  }, [loadsUserData, toast]);

  // Resolve a stashed ?export=<id> deep link: download the export directly
  // (mirrors NotificationsPanel.handleDownloadExport). A presign that has
  // expired (no downloadUrl) opens the LiDAR panel so the user can re-presign.
  useEffect(() => {
    if (!loadsUserData) return;
    const exportId = sessionStorage.getItem("pendingExportId");
    if (!exportId) return;
    sessionStorage.removeItem("pendingExportId");

    getTopoExport(exportId)
      .then((view) => {
        if (view.downloadUrl) {
          triggerDownload(view.downloadUrl);
        } else {
          setMapsView("lidar");
          setActivePanel("maps");
          toast.error("Export download expired. Open it again from Maps, LiDAR topos.");
        }
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load the export."));
      });
  }, [loadsUserData, toast, setMapsView]);

  // Resolve a stashed ?geoPdfJob=<id> deep link: open the GeoPDFs panel, whose
  // job list carries per-item download buttons (and auto-download for jobs this
  // tab queued). Refetch so a just-finished job shows immediately.
  useEffect(() => {
    if (!loadsUserData) return;
    const geoPdfJobId = sessionStorage.getItem("pendingGeoPdfJobId");
    if (!geoPdfJobId) return;
    sessionStorage.removeItem("pendingGeoPdfJobId");
    setMapsView("geopdfs");
    setActivePanel("maps");
    setGeoPdfJobsRefetch((n) => n + 1);
  }, [loadsUserData, setMapsView]);

  // First login (empty account): offer a non-forced onboarding choice once,
  // after the first place fetch completes. The user picks RopeWiki, file
  // import, or starting empty — nothing auto-runs.
  //
  // A FAILED fetch is not an empty account. `places` is `[]` before the first
  // response and stays `[]` when one never arrives, so gating on the count
  // alone greets a user whose load 429'd, timed out or dropped offline with
  // "Welcome to Logjam — load the NSW place database?" over the places they
  // already have. Worse than alarming: the offer they are most likely to take
  // is the one that writes a second copy of a dataset they cannot see. It
  // needs a load that SUCCEEDED and came back empty. (Found 2026-09-19 as the
  // a11y suite's fourteenth case failing behind an onboarding dialog it never
  // asked for; the suite is what pushes the dev limiter hard enough to see it.)
  useEffect(() => {
    if (placesLoaded && !importChecked.current) {
      importChecked.current = true;
      if (!placesError && places.length === 0) {
        setShowOnboarding(true);
      }
    }
  }, [placesLoaded, placesError, places.length]);

  // Derived values
  const allPlaces = [...places, ...sharedPlaces];
  const filteredPlaces = useMemo(
    () => [
      ...places.filter((c) => passesFilters(c, filters, true)),
      ...sharedPlaces.filter((c) => passesFilters(c, filters, false)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [places, sharedPlaces, filters],
  );
  const filtersActive = hasActiveFilters(filters);
  const clearFilters = () => setFilters(emptyFilters);
  const place = allPlaces.find((c) => c.id === selectedPlaceID);
  const ownedPlaceIds = new Set(places.map((c) => c.id));
  const isOwnedPlace = place != null && ownedPlaceIds.has(place.id);

  const selectedAreaPlaces = selectedAreaPlaceIds
    .map((id) => allPlaces.find((c) => c.id === id))
    .filter((c): c is TPlace => c != null);

  const cancelDrawingRoute = () => {
    setDrawingRoute(false);
    routeDraft.reset();
    setEditingRouteId(null);
    setDrawColor(null);
    routeHover.set(null);
    // The tool is a PAGE, so leaving it has to go somewhere. Clearing the draft
    // while the panel still showed "way-draw" rendered nothing at all, which is
    // the blank panel left behind after a discard (operator, 2026-09-17). Back
    // to the way being edited, or to the list a new route came from. A save
    // calls this too and then opens the saved way, which wins.
    setActivePanel(
      editingRouteId && selectedWay?.id === editingRouteId ? "way-detail" : "ways",
    );
  };

  // FEUI-010: Cancel/Clear used to wipe an in-progress route (dozens of
  // deliberate map clicks, plus `reset()` also drops the undo history) with
  // no confirm. Reuse the same discard-guard the dialogs already use for
  // unsaved changes — "dirty" here means at least one placed vertex.
  //
  // These two sit ABOVE the loading/unauthenticated early returns below: a
  // hook after an early return runs on some renders and not others, so the
  // sign-in -> map transition would shift every later hook's slot.
  // "Dirty" for a NEW route is any point placed; for an EDIT it is the geometry
  // differing from what was opened. Closing an edit you made no change to used
  // to raise a discard confirm over work that did not exist, which teaches
  // people to dismiss the confirm that matters (operator, 2026-09-17).
  const editingOriginal = editingRouteId
    ? (routes.find((route) => route.id === editingRouteId) ?? null)
    : null;
  const draftChanged = editingOriginal
    ? JSON.stringify(routeDraft.points) !== JSON.stringify(editingOriginal.points)
    : routeDraft.points.length > 0;

  const cancelRouteGuard = useUnsavedChangesGuard(
    draftChanged,
    cancelDrawingRoute,
  );
  const clearRouteGuard = useUnsavedChangesGuard(
    routeDraft.points.length > 0,
    () => routeDraft.reset(),
  );

  // While checking for an existing session, show a branded splash instead of
  // a blank flash before the sign-in form or map appears.
  if (auth.state === "loading") {
    return (
      <div className={classes.splash}>
        <BrandMark className={classes.splashMark} />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <SignIn
        authState={auth.state}
        error={auth.error}
        onSignIn={auth.signIn}
        onSignUp={auth.signUp}
        onConfirmSignUp={auth.confirmSignUp}
        onResendCode={auth.resendSignUpCode}
        onForgotPassword={auth.forgotPassword}
        onConfirmForgotPassword={auth.confirmForgotPassword}
        goToSignUp={auth.goToSignUp}
        goToSignIn={auth.goToSignIn}
        goToForgotPassword={auth.goToForgotPassword}
      />
    );
  }

  const selectedRoute =
    selectedWay?.kind === "route" ? (routes.find((r) => r.id === selectedWay.id) ?? null) : null;

  /**
   * Open a way's own page, and centre the map on it.
   *
   * Opening and centring are ONE action: a page describing a line while the map
   * shows somewhere else is two halves of an answer (operator, 2026-09-17).
   */
  const openWay = (way: WayItem, verb?: WayVerbId) => {
    setSelectedWay(way);
    setPendingWayVerb(verb ?? null);
    if (way.bounds) setFlyToBounds(way.bounds);
    setActivePanel("way-detail");
  };

  /**
   * A friend's route has just been copied into the user's own Ways — show them
   * the copy.
   *
   * The copying itself is the way page's, because it is half of "save it and
   * remove the share" and those two halves must not be able to drift apart.
   * What is left here is navigation, which only App can do.
   */
  const showCopiedRoute = (copy: TRoute) => {
    refetchRoutes();
    openWay(wayFromRoute(copy, currentUser?.id ?? null, sharedPlaceIds));
  };

  const startDrawingRoute = () => {
    setEditingRouteId(null);
    routeDraft.reset();
    const nextColor = pickNextTrackColor(routes.map((r) => r.color));
    setDrawColor(nextColor);
    setDrawingRoute(true);
    // The tool is a PAGE now, not a card over the map: the panel is where a
    // route's figures already live, and the canvas stays clear for drawing.
    setActivePanel("way-draw");
  };

  const startEditingRoute = (route: TRoute) => {
    setEditingRouteId(route.id);
    // Anchors come back with the route, so a snapped line reopens with the
    // user's own handful of points rather than every snapped vertex.
    routeDraft.reset({ points: route.points, anchors: route.anchors });
    setDrawColor(route.color ?? pickNextTrackColor(routes.map((r) => r.color)));
    setDrawingRoute(true);
    // Editing centres it too: the points being edited must be on screen.
    const bounds = wayFromRoute(route, currentUser?.id ?? null, sharedPlaceIds).bounds;
    if (bounds) setFlyToBounds(bounds);
    setActivePanel("way-draw");
  };

  const saveDrawnRoute = async (name: string) => {
    setSavingRoute(true);
    try {
      const chosenColor = drawColor ?? undefined;
      const payload = {
        name,
        points: routeDraft.points,
        anchors: routeDraft.anchorIndices,
        ...(chosenColor ? { color: chosenColor } : {}),
      };
      const result = editingRouteId
        ? await updateRoute(editingRouteId, payload)
        : await createRoute(payload);
      setNamingRoute(false);
      cancelDrawingRoute();
      refetchRoutes();
      openWay(wayFromRoute(result, currentUser?.id ?? null, sharedPlaceIds));
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't save the route."));
    } finally {
      setSavingRoute(false);
    }
  };

  // Blocking re-consent gate (PRIV-002): a signed-in user whose recorded
  // consent version is stale or absent must re-consent before using the app
  // (the privacy.html / tos.html "re-consent on next sign-in" promise). The
  // pending-key fast path keeps the gate from flashing for fresh sign-ups
  // whose consent PATCH (recorded by the effect above) is still in flight.
  // Decided once, up beside the data hooks the same answer holds back
  // (`consentGate`), so the gate and the fetches can never disagree.
  if (consentBlocked) {
    return <ConsentGate onAccepted={applyCurrentUser} onSignOut={auth.signOut} />;
  }

  const dimUI =
    pickingCoords || selectingFilterArea || selectingGeoPdfExtent;

  // A filter changes what the MAP shows too, so the map says so while the
  // Places page is closed or scrolled away.
  const notices =
    filtersActive && !dimUI ? (
      <Notice
        icon={Filter}
        action={<IconButton icon={X} label="Clear filters" size={14} round onClick={clearFilters} />}
      >
        Showing {filteredPlaces.length} of {allPlaces.length} places
      </Notice>
    ) : null;

  // "Make a map" from Places: the selection's bounds prefill the chosen product.
  // A topo goes straight to its dialog with the box; a GeoPDF opens its paper
  // frame on the map over the box, because the paper decides the final extent.
  const makeMap = (bounds: TBbox, kind: MapKind) => {
    if (kind === "topo") {
      setPendingTopoBbox(bounds);
      setShowTopo(true);
      return;
    }
    setEditingGeoPdfTemplate(undefined);
    setInitialGeoPdfTemplateId(null);
    setGeoPdfPaperAspect(210 / 297);
    setGeoPdfPaperDimensions({ w: 210, h: 297 });
    setGeoPdfInitialExtent(bounds);
    setGeoPdfInitialScale(undefined);
    setActivePanel(null);
    setSelectingGeoPdfExtent(true);
  };

  // Verbs that START on the map. Each opens an existing flow; there is no web
  // measure tool, so none is offered.
  const mapTools: MapTool[] = [
    { id: "route", label: "Draw a route", icon: PenTool, onSelect: startDrawingRoute },
    { id: "place", label: "Add a place", icon: MapPinPlus, onSelect: () => setShowAdd(true) },
    {
      id: "make-map",
      label: "Make a map of an area",
      icon: SquareDashed,
      menu: [
        {
          id: "topo",
          label: "LiDAR topo",
          icon: Mountain,
          onSelect: () => {
            setActivePanel(null);
            setSelectingTopoBbox(true);
          },
        },
        {
          id: "geopdf",
          label: "GeoPDF",
          icon: FileText,
          onSelect: () => {
            setEditingGeoPdfTemplate(undefined);
            setInitialGeoPdfTemplateId(null);
            setShowGeoPdf(true);
          },
        },
      ],
    },
  ];
  // Mobile: any map-selection flow needs the bottom sheet out of the way so the
  // map is tappable. Collapses the sheet to peek; restored when the flow ends.
  const mapInteractionActive =
    pickingCoords ||
    selectingFilterArea ||
    selectingGeoPdfExtent ||
    selectingTopoBbox;

  return (
    <div className={classes.app}>
      <a href="#main-content" className={classes.skipLink}>
        Skip to map
      </a>
      <TopoDialog
        open={showTopo}
        onClose={() => {
          setShowTopo(false);
          setSelectingTopoBbox(false);
          setInitialTopoTemplateId(null);
          // The dialog empties itself on a real close; the drawn area is held
          // out here (going off to draw closes the dialog), so it has to be
          // emptied with it or the next topo starts with the last one's box.
          setPendingTopoBbox(null);
        }}
        onSelectBbox={() => {
          setShowTopo(false);
          setSelectingTopoBbox(true);
        }}
        awaitingBbox={selectingTopoBbox}
        pendingBbox={pendingTopoBbox}
        onJobCreated={handleTopoJobCreated}
        onTemplateSaved={() => setTopoTemplateRefetch((n) => n + 1)}
        initialTemplateId={initialTopoTemplateId}
        existingTopoNames={[...activeTopoJobs, ...completedTopoJobs]
          .map((j) => j.name)
          .filter((n): n is string => !!n)}
      />
      <GeoPdfDialog
        open={showGeoPdf}
        onClose={() => {
          setShowGeoPdf(false);
          setEditingGeoPdfTemplate(undefined);
          setInitialGeoPdfTemplateId(null);
        }}
        onSelectOnMap={(aspect, paperDims, extent, scale) => {
          setGeoPdfPaperAspect(aspect);
          setGeoPdfPaperDimensions(paperDims);
          setGeoPdfInitialExtent(extent);
          setGeoPdfInitialScale(scale);
          setShowGeoPdf(false);
          setActivePanel(null);
          setSelectingGeoPdfExtent(true);
        }}
        pendingExtent={pendingGeoPdfExtent}
        pendingScale={pendingGeoPdfScale}
        activeLayerId={activeLayerId}
        completedTopoJobs={completedTopoJobs}
        mapCenter={mapCenter}
        places={places}
        sharedPlaces={sharedPlaces}
        templateMode={editingGeoPdfTemplate !== undefined}
        editingTemplate={editingGeoPdfTemplate ?? undefined}
        onTemplateSaved={() => {
          setEditingGeoPdfTemplate(undefined);
          setShowGeoPdf(false);
          setGeoPdfTemplateRefetch((n) => n + 1);
        }}
        initialTemplateId={initialGeoPdfTemplateId}
        onJobQueued={handleGeoPdfJobQueued}
      />
      <div className={dimUI ? classes.dimmed : undefined}>
        <NavRail
          activePanel={activePanel}
          onPanelChange={handlePanelChange}
          badgeCounts={{ inbox: unreadCount }}
        />
        <SidebarPanel
          activePanel={activePanel}
          onClose={handlePanelClose}
          onTopoFlyTarget={(footprint) => {
            setLidarEnabled(true);
            setTopoFlyTarget(footprint);
          }}
          logsView={logsView}
          onLogsViewChange={setLogsView}
          mapsView={mapsView}
          onMapsViewChange={setMapsView}
          onStartDrawingRoute={startDrawingRoute}
          waysLoaded={waysLoaded}
          allRoutes={routes}
          placeTracks={placeTracks}
          standaloneFiles={standaloneFiles}
          standaloneFilesError={standaloneFilesError}
          onOpenWay={openWay}
          currentUserId={currentUser?.id ?? null}
          wayDetail={
            selectedWay ? (
              <WayDetailPanel
                way={selectedWay}
                route={selectedRoute}
                file={standaloneFiles.find((each) => each.id === selectedWay.id) ?? null}
                initialVerb={pendingWayVerb}
                onVerbConsumed={() => setPendingWayVerb(null)}
                friends={friends}
                ownedPlaces={places}
                sharedPlaces={sharedPlaces}
                allRoutes={routes}
                onBack={() => {
                  setSelectedWay(null);
                  setActivePanel("ways");
                }}
                onClose={() => setActivePanel(null)}
                onEdit={startEditingRoute}
                onCopied={showCopiedRoute}
                onChanged={() => {
                  refetchRoutes();
                  refetchStandaloneFiles();
                }}
                onOpenPlace={(placeId) => {
                  setSelectedPlaceID(placeId);
                  setActivePanel("place-detail");
                }}
                onDeleteFile={handleDeleteStandaloneFile}
                routeHover={routeHover}
              />
            ) : null
          }
          drawPanel={
            drawingRoute ? (
              <RouteDrawPanel
                points={routeDraft.points}
                anchorCount={routeDraft.draft.anchors.length}
                canUndo={routeDraft.canUndo}
                atCap={routeDraft.atCap}
                editingName={routes.find((r) => r.id === editingRouteId)?.name ?? null}
                color={drawColor}
                onColorChange={setDrawColor}
                onUndo={routeDraft.undo}
                onClear={clearRouteGuard.requestClose}
                onReverse={routeDraft.reverse}
                routeHover={routeHover}
                // Editing keeps the name it already has. Asking again on every
                // save made a rename the price of moving one point, and the
                // dialog's only honest default was the answer it already had
                // (operator, 2026-09-17). Naming belongs to CREATING a route.
                onSave={() => {
                  const existing = routes.find((r) => r.id === editingRouteId);
                  if (existing) void saveDrawnRoute(existing.name);
                  else setNamingRoute(true);
                }}
                onCancel={cancelRouteGuard.requestClose}
                saving={savingRoute}
                snapMode={snapMode}
                onSnapModeChange={setSnapMode}
              />
            ) : null
          }
          places={places}
          placesLoaded={placesLoaded}
          placesTotal={placesTotal}
          sharedPlaces={sharedPlaces}
          onAddPlace={() => setShowAdd(true)}
          onOpenUnifiedImport={() => setShowUnifiedImport(true)}
          onSharePlaces={setSelectedAreaPlaceIds}
          onMakeMap={makeMap}
          onHoverPlace={placeHighlight.set}
          onFiltersOpenChange={setSidebarSheetOpen}
          onRefetch={refetch}
          filters={filters}
          onChangeFilters={setFilters}
          onDrawFilterArea={startFilterAreaSelection}
          onFilterToMapView={() => {
            const bounds = mapBoundsRef.current;
            if (bounds) setFilters({ ...filters, area: bounds });
          }}
          openFiltersRequested={openFiltersRequested}
          onOpenFiltersConsumed={consumeOpenFilters}
          onFlyToPlace={(lat, lng) => setFlyToPlace({ lat, lng })}
          onOpenGeoPdf={() => {
            setEditingGeoPdfTemplate(undefined);
            setInitialGeoPdfTemplateId(null);
            setShowGeoPdf(true);
          }}
          onOpenGeoPdfWithTemplate={(id) => {
            setEditingGeoPdfTemplate(undefined);
            setInitialGeoPdfTemplateId(id);
            setShowGeoPdf(true);
          }}
          onEditGeoPdfTemplate={(t) => {
            setEditingGeoPdfTemplate(t);
            setInitialGeoPdfTemplateId(null);
            setShowGeoPdf(true);
          }}
          onCreateGeoPdfTemplate={() => {
            setEditingGeoPdfTemplate(null);
            setInitialGeoPdfTemplateId(null);
            setShowGeoPdf(true);
          }}
          geoPdfTemplateRefetch={geoPdfTemplateRefetch}
          topoTemplateRefetch={topoTemplateRefetch}
          geoPdfJobsRefetch={geoPdfJobsRefetch}
          activeTopoJobs={activeTopoJobs}
          completedTopoJobs={completedTopoJobs}
          topoJobsLoaded={completedTopoJobsLoaded}
          topoExports={topoExports}
          topoExportsTotal={topoExportsTotal}
          onRefetchTopoExports={refetchTopoExports}
          setLidarJobToggles={setLidarJobToggles}
          onOpenTopo={() => {
            setInitialTopoTemplateId(null);
            setShowTopo(true);
          }}
          onRefetchCompletedTopoJobs={refetchCompletedTopoJobs}
          onDismissActiveJob={handleDismissActiveTopoJob}
          onQuotaChanged={refetchCurrentUser}
          currentUser={currentUser}
          onOpenTopoWithTemplate={(templateId) => {
            setInitialTopoTemplateId(templateId);
            setShowTopo(true);
          }}
          friends={friends}
          friendRequests={friendRequests}
          onRefetchFriends={refetchFriends}
          onRefetchShared={refetchShared}
          notifications={notifications}
          notificationsLoaded={notificationsLoaded}
          notificationsError={notificationsError}
          notificationsTotal={notificationsTotal}
          onRefetchNotifications={refetchNotifications}
          onOverrideNotificationRead={overrideNotificationRead}
          setSelectedPlaceID={setSelectedPlaceID}
          setActivePanel={setActivePanel}
          place={place}
          isOwnedPlace={isOwnedPlace}
          onPickCoords={startPickingCoords}
          pickingCoords={pickingCoords}
          onCancelPickCoords={cancelPickingCoords}
          tripLogs={tripLogs}
          tripLogsTotal={tripLogsTotal}
          tripLogsLoaded={tripLogsLoaded}
          onRefetchTripLogs={refetchAfterTripWrite}
          customFieldDefs={customFieldDefs}
          onCustomFieldDefsChange={setCustomFieldDefs}
          placeCustomFieldDefs={placeCustomFieldDefs}
          onPlaceCustomFieldDefsChange={setPlaceCustomFieldDefs}
          placeTypes={placeTypes}
          onPlaceTypesChange={setPlaceTypes}
          vectorStyle={vectorStyle}
          onVectorStyleChange={setLiveVectorStyle}
          collapseToPeek={mapInteractionActive}
        />
      </div>
      <main id="main-content" className={classes.main}>
      <h1 className={classes.visuallyHidden}>Logjam place map</h1>
      <Map
        filters={filters}
        places={places}
        sharedPlaces={sharedPlaces}
        showPlaces={showPlaces}
        // One overlay for every line, so nothing has to be partitioned by
        // ownership on the way to the map any more.
        showWays={showWays}
        placeTracks={placeTracks}
        standaloneTracks={standaloneTracks}
        routes={routes}
        routeHover={routeHover}
        selectRoute={(id) => {
          const route = routes.find((r) => r.id === id);
          if (route) openWay(wayFromRoute(route, currentUser?.id ?? null, sharedPlaceIds));
        }}
        drawingRoute={drawingRoute}
        drawColor={drawColor ?? undefined}
        drawPoints={routeDraft.points}
        drawAnchorIndices={routeDraft.anchorIndices}
        draft={routeDraft.draft}
        editingRouteId={editingRouteId}
        snapMode={snapMode}
        onDrawPointAdd={routeDraft.addAnchor}
        onDrawSnap={routeDraft.applySnap}
        onDrawPointMove={routeDraft.moveAnchorAt}
        onDrawPointDelete={routeDraft.deleteAnchorAt}
        onDrawPointInsert={routeDraft.insertAnchorAt}
        selectPlace={(id) => {
          // A pin opens the place, wherever you pressed it from. It used to
          // scroll to the row instead while the Places list was open, which
          // made one gesture mean two things depending on a panel the user
          // may not have been looking at (operator, 2026-09-19).
          setSelectedPlaceID(id);
          setActivePanel("place-detail");
        }}
        pickingCoords={pickingCoords}
        onCoordsPicked={handleCoordsPicked}
        onCancelPickCoords={cancelPickingCoords}
        selectingFilterArea={selectingFilterArea}
        onFilterAreaSelected={(bbox) => {
          setSelectingFilterArea(false);
          setFilters({ ...filters, area: bbox });
          // Straight back to where the button was, with the filters open — the
          // panel was closed to uncover the map, not dismissed.
          setActivePanel("places");
          setOpenFiltersRequested(true);
        }}
        onMapBoundsChange={(bounds) => {
          mapBoundsRef.current = bounds;
          setMapBounds(bounds);
        }}
        selectingBbox={selectingTopoBbox}
        onBboxSelected={(bbox) => {
          setPendingTopoBbox(bbox);
          setSelectingTopoBbox(false);
          setShowTopo(true);
        }}
        topoLayers={combinedTopoLayers}
        vectorStyle={vectorStyle}
        activeLayerId={activeLayerId}
        selectingGeoPdfExtent={selectingGeoPdfExtent}
        geoPdfPaperAspect={geoPdfPaperAspect}
        geoPdfPaperDimensions={geoPdfPaperDimensions}
        geoPdfInitialExtent={geoPdfInitialExtent}
        geoPdfInitialScale={geoPdfInitialScale}
        onGeoPdfExtentConfirmed={(extent, scale) => {
          setPendingGeoPdfExtent(extent);
          setPendingGeoPdfScale(scale);
          setSelectingGeoPdfExtent(false);
          setShowGeoPdf(true);
        }}
        onGeoPdfExtentCancelled={() => {
          setSelectingGeoPdfExtent(false);
          setShowGeoPdf(true);
        }}
        onMapViewChange={(view) => setMapCenter(view)}
        initialView={mapCenter}
        topoFlyTarget={topoFlyTarget}
        onTopoFlyConsumed={() => setTopoFlyTarget(null)}
        flyToPlace={flyToPlace}
        onFlyToPlaceConsumed={() => setFlyToPlace(null)}
        panelOpen={activePanel !== null}
        sheetOpen={sidebarSheetOpen}
        placeHighlight={placeHighlight}
        placeTypes={placeTypes}
        layersButton={
          <MapButton
            ref={layersButtonRef}
            icon={Layers}
            label="Layers"
            expanded={layersOpen}
            onClick={() => setLayersOpen((open) => !open)}
          />
        }
        mapTools={mapTools}
        notices={notices}
        flyToBounds={flyToBounds}
        onFlyToBoundsConsumed={() => setFlyToBounds(null)}
        onTopoSourceUnavailable={handleTopoSourceUnavailable}
      />
      </main>

      <LayersPopover
        open={layersOpen}
        onClose={() => setLayersOpen(false)}
        anchorRef={layersButtonRef}
        showPlaces={showPlaces}
        setShowPlaces={setShowPlaces}
        showWays={showWays}
        setShowWays={setShowWays}
        placeCount={places.length + sharedPlaces.length}
        wayCount={showWays ? wayCount : null}
        lidarEnabled={lidarEnabled}
        setLidarEnabled={setLidarEnabled}
        lidarLayerToggles={lidarLayerToggles}
        setLidarLayerToggles={setLidarLayerToggles}
        lidarLayerOrder={lidarLayerOrder}
        setLidarLayerOrder={setLidarLayerOrder}
        unavailableTopoLayerNames={unavailableTopoLayerNames}
        completedTopoJobs={completedTopoJobs}
        lidarJobToggles={lidarJobToggles}
        setLidarJobToggles={setLidarJobToggles}
        mapBounds={mapBounds}
        baseLayers={BASE_LAYERS}
        activeLayerId={activeLayerId}
        onActiveLayerChange={setActiveLayerId}
        mapView={mapCenter}
      />

      <ConfirmDialog
        open={cancelRouteGuard.guardOpen}
        // Editing and drawing lose different things, so they cannot share one
        // sentence: abandoning an edit costs the changes, not the route.
        title={editingRouteId ? "Discard your edits?" : "Discard this route?"}
        message={
          editingRouteId
            ? "Your changes to this route will be lost. The route itself is not deleted."
            : "Your placed points will be lost. This cannot be undone."
        }
        confirmLabel="Discard"
        confirmColor="error"
        onConfirm={cancelRouteGuard.confirmDiscard}
        onClose={cancelRouteGuard.cancelDiscard}
      />

      <ConfirmDialog
        open={clearRouteGuard.guardOpen}
        title="Clear this route?"
        message="Your placed points will be lost. This cannot be undone."
        confirmLabel="Clear"
        confirmColor="error"
        onConfirm={clearRouteGuard.confirmDiscard}
        onClose={clearRouteGuard.cancelDiscard}
      />

      <RouteNameDialog
        open={namingRoute}
        initialName={
          routes.find((r) => r.id === editingRouteId)?.name ?? "New route"
        }
        busy={savingRoute}
        onSave={(name) => void saveDrawnRoute(name)}
        onClose={() => setNamingRoute(false)}
      />

      {selectingFilterArea && (
        <div className={classes.selectAllButtons}>
          <Button compact variant="filled" onClick={cancelFilterAreaSelection}>
            Cancel
          </Button>
        </div>
      )}

      {/* First-login onboarding choice */}
      <OnboardingChoiceDialog
        open={showOnboarding}
        onLoaded={refetch}
        onImportFiles={() => {
          setShowOnboarding(false);
          setImportedFromOnboarding(true);
          setShowUnifiedImport(true);
        }}
        onStartEmpty={() => setShowOnboarding(false)}
      />

      {/* Unified file importer (places + logbooks) */}
      <UnifiedImportDialog
        open={showUnifiedImport && !pickingCoords}
        onClose={() => {
          setShowUnifiedImport(false);
          setImportedFromOnboarding(false);
        }}
        onBack={
          importedFromOnboarding
            ? () => {
                setShowUnifiedImport(false);
                setImportedFromOnboarding(false);
                setShowOnboarding(true);
              }
            : undefined
        }
        places={places}
        customFieldDefs={customFieldDefs}
        onCustomFieldDefsChange={setCustomFieldDefs}
        placeCustomFieldDefs={placeCustomFieldDefs}
        placeTypes={placeTypes}
        currentUser={currentUser}
        onRefetchPlaces={refetch}
        onRefetchTripLogs={refetchTripLogs}
        onPickCoords={startPickingCoords}
      />

      {/* Add place dialog */}
      <PlaceDialog
        place={null}
        open={showAdd && !pickingCoords}
        onClose={() => setShowAdd(false)}
        onSaved={refetch}
        onPickCoords={startPickingCoords}
        onCancelPickCoords={cancelPickingCoords}
        customFieldDefs={placeCustomFieldDefs}
        onCustomFieldDefsChange={setPlaceCustomFieldDefs}
        placeTypes={placeTypes}
      />

      <SelectedPlacesDialog
        open={selectedAreaPlaceIds.length > 0}
        selectedPlaces={selectedAreaPlaces}
        placeCustomFieldDefs={placeCustomFieldDefs}
        availablePlaces={allPlaces}
        ownedPlaceIds={ownedPlaceIds}
        friends={friends}
        onClose={() => setSelectedAreaPlaceIds([])}
        onDeleted={refetch}
        onQuotaChanged={refetchCurrentUser}
        onRemovePlace={(id) => setSelectedAreaPlaceIds((ids) => ids.filter((x) => x !== id))}
        onAddPlace={(id) =>
          setSelectedAreaPlaceIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
        }
      />
    </div>
  );
}

export default App;
