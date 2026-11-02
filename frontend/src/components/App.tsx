import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CurrentUserIdContext } from "../CurrentUserIdContext";
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
import { routeMadeTopoJob } from "./dialogs/topoUpload";
import GeoPdfDialog from "./dialogs/GeoPdfDialog";
import PlaceDialog from "./dialogs/PlaceDialog";
import UnifiedImportDialog from "./dialogs/UnifiedImportDialog";
import OnboardingChoiceDialog from "./dialogs/OnboardingChoiceDialog";
import SelectedPlacesDialog from "./dialogs/SelectedPlacesDialog";
import classes from "./App.module.css";
import type { TBbox } from "./map/Map";
import { TERRAIN_ENTRIES, terrainEntries } from "./map/terrainEntries";
import { setRoutedAreas } from "./map/terrainRouter";
import { useBootDefinitions } from "../useBootDefinitions";
import { useCompletedTopoJobs } from "../useCompletedTopoJobs";
import { createPlaceHighlight } from "./map/placeHighlight";
import type { TFilters, TPlace, TPlaceType } from "../placeUtils";
import type { ScopedCustomFieldDef, StandaloneFile } from "@logjam/shared";
import { PANEL_TITLES, type LogsView, type PanelId } from "./sidebar/panels";
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
  useTopoExports,
  fetchCurrentUser,
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
import { consentGate, currentConsentVersionOf } from "../consent";
import ConsentGate from "./ConsentGate";
import { RouteDrawPanel } from "./routes/RouteDrawPanel";
import { MeasurePanel } from "./map/MeasurePanel";
import RouteNameDialog from "./dialogs/RouteNameDialog";
import WayDetailPanel from "./sidebar/panels/WayDetailPanel";
import TripLogDialog, {
  type TripLogPrefill,
  type TripLogTrack,
} from "./dialogs/TripLogDialog";
import { seedBaseLayer } from "./dialogs/geoPdfBaseLayer";
import { mapLayerFor } from "./dialogs/geoPdfFraming";
import { footprintBounds } from "./map/topoFootprint";
import {
  armBox,
  boxFor,
  boxPickDimsUI,
  endBox,
  isPicking,
  NO_BOX_PICK,
  type BoxPick,
} from "./map/boxPick";
import {
  boundsOfPoints,
  buildWays,
  wayFromRoute,
  type WayItem,
} from "./sidebar/panels/waysModel";
import { createRouteHoverChannel } from "./map/routeHover";
import type { WayVerbId } from "./sidebar/panels/wayActions";
import FriendInviteDialog from "./dialogs/FriendInviteDialog";
import PlansPanel from "./plans/PlansPanel";
import PlanDetailPanel from "./plans/PlanDetailPanel";
import PlanInvitedPage from "./plans/PlanInvitedPage";
import PlanInviteLinkDialog from "./plans/PlanInviteLinkDialog";
import { planMapPress } from "./plans/plansModel";
import { usePlan, usePlans } from "../plansApi";
import ConfirmDialog from "./dialogs/ConfirmDialog";
import { useUnsavedChangesGuard } from "../useUnsavedChangesGuard";
import {
  TOPO_OVERLAY_SOURCE,
  GEOPDF_OVERLAY_ATTRIBUTION,
  pickNextTrackColor,
  TERRAIN_LAYER_DEFAULTS,
  TERRAIN_LAYER_KEYS,
  drawsNswContours,
  drawsNswHillshade,
  normalizeTerrainLayers,
  type TerrainSwitchKey,
  MAP_MEASURE,
  MAP_MEASURE_ICON,
  MAP_TERRAIN,
  LIDAR_JOB_COPY,
  opensPreview,
  PLAN_ADD_VERBS,
  planVerbsFor,
  TRIP_PLAN_PAGE,
  tripPlansBadgeCount,
  tripPlanTripLogPrefill,
  type TripPlanItemKind,
  type TripPlanPageView,
} from "@logjam/shared";
import type { MapPointCoord, OverlaySource } from "@logjam/shared";
import { useAuth, signOut } from "../useAuth";
import { useStoredState } from "../useStoredState";
import { useSlopeBands } from "../slopeBandsPreference";
import { useThemePreferences } from "../themePreferences";
import { useToast } from "./feedback/ToastProvider";
import { messageFromError } from "../errors/messageFromError";
import { triggerDownload } from "../download";

function App() {
  const toast = useToast();
  // Session-scoped, like the search box beside it: every member of TFilters
  // hides places, and a filter the user set last month greets them as "my
  // places are missing" rather than as a favour. Sort order is the
  // counter-example and stays in localStorage: it reorders, it never hides.
  // Survives the panel's unmount-on-close without surviving the week.
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
  const consumeOpenFilters = useCallback(
    () => setOpenFiltersRequested(false),
    [],
  );
  const [selectedPlaceID, setSelectedPlaceIDRaw] = useState<string | null>(
    null,
  );
  // The trip whose page is open. A trip is READ on a page like a place and a
  // way (DESIGN.md), so it needs the same one piece of state.
  const [selectedTripLogId, setSelectedTripLogId] = useState<string | null>(
    null,
  );
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  // The plan whose page is open.
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  // "Start a trip log from this plan": the trip form, pre-filled.
  const [tripLogPrefill, setTripLogPrefill] = useState<TripLogPrefill | null>(
    null,
  );
  // Which view the two-view pages open on — remembered for the session, so a
  // return to Logs lands where the user left it.
  const [logsView, setLogsView] = useStoredState<LogsView>(
    "logjam.logsView",
    "logs",
    sessionStorage,
  );
  // What is on the map is a popover over the map, not a page.
  const [layersOpen, setLayersOpen] = useState(false);
  // The Inbox's "Show" opens the popover on the sharpened areas.
  const [layersStartView, setLayersStartView] = useState<{
    view: "sharpened";
  } | null>(null);
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

  // On the device, like the basemap choice; the slope bands are the account's.
  const [storedTerrainLayers, setStoredTerrainLayers] = useStoredState<unknown>(
    "logjam.terrainLayers",
    TERRAIN_LAYER_DEFAULTS,
  );
  const terrainLayers = normalizeTerrainLayers(storedTerrainLayers);
  const setTerrainLayer = (key: TerrainSwitchKey, on: boolean) =>
    setStoredTerrainLayers((prev: unknown) => ({
      ...normalizeTerrainLayers(prev),
      [key]: on,
    }));

  const [showAdd, setShowAdd] = useState(false);
  // "Add a place here" from the map: the form opens on this spot.
  const [addPlaceAt, setAddPlaceAt] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [showUnifiedImport, setShowUnifiedImport] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // True when the unified importer was opened from the onboarding wizard, so its
  // Back/close returns to the welcome hub instead of dropping onto an empty map.
  const [importedFromOnboarding, setImportedFromOnboarding] = useState(false);
  // Whether the first-login onboarding check has run (once, below).
  const [importChecked, setImportChecked] = useState(false);

  // What is drawn on the map. TWO overlays over the user's own data, divided by
  // what a thing IS — a pin is a place, a line is a way — so nothing belongs to
  // both and no toggle overlaps another (LayersPopover carries the reasoning).
  //
  // NEW KEYS, not the old four reused: those answered different questions, and
  // a stored `false` for "shared ways" arriving as "hide every line I have"
  // would silently empty the map of someone who had only ever hidden a friend's.
  const [showPlaces, setShowPlaces] = useStoredState("logjam.showPlaces", true);
  const [showWays, setShowWays] = useStoredState("logjam.showWays", true);
  // Off until asked for: the layer fetches a public file only while it is on.
  const [showGauges, setShowGauges] = useStoredState(
    "logjam.showGauges",
    false,
  );

  // Route draw/edit mode. The vertex list lives here (not in Map) so the HUD
  // can show the running distance and drive undo. `editingRouteId` is null
  // while drawing a new route.
  const [drawingRoute, setDrawingRoute] = useState(false);
  const [drawColor, setDrawColor] = useState<string | null>(null);
  const routeDraft = useRouteDraft();
  // The measure tool is armed exactly while its page is open, and borrows the
  // route tool's draft: only one of the two holds the map's clicks at a time.
  const measuring = activePanel === "measure";
  // What to do once the route tool has been left, if its discard confirm is
  // what stands in the way (arming the measure tool over a draft with points).
  const afterRouteCancel = useRef<(() => void) | null>(null);
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
  // "Log a trip" on a track: the form opens over the map, from here, so the
  // row's ⋯, the page's ⋯ and a line on the map all reach the same one.
  const [logTripFromTrack, setLogTripFromTrack] = useState<TripLogTrack | null>(
    null,
  );
  // A way's extent, for the map to fit. Consumed, not counted (DESIGN.md).
  // A tuple, as `WayItem.bounds` and MapLibre's `fitBounds` both are — not the
  // `RegionBbox` object the topo flows pass around.
  const [flyToBounds, setFlyToBounds] = useState<
    [number, number, number, number] | null
  >(null);
  // Where along a line the elevation-profile cursor sits, so the chart and the
  // map point at the same place. NOT state: it changes many times a second, and
  // as state every move re-rendered App, the map and the panel before the dot
  // could move (DESIGN.md — `map/routeHover.ts` carries the full reasoning).
  const routeHover = useMemo(() => createRouteHoverChannel(), []);

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
  // on the way out, so the panel it belongs to never needs naming here.
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);
  const [placeHighlight] = useState(createPlaceHighlight);

  // Topo dialog
  const [showTopo, setShowTopo] = useState(false);
  // The box tool, drawing a topo's area or an export's (`boxPick.ts`).
  const [boxPick, setBoxPick] = useState<BoxPick>(NO_BOX_PICK);
  const selectingTopoBbox = isPicking(boxPick, "topo");
  const selectingExportBox = isPicking(boxPick, "export");
  const [pendingTopoBbox, setPendingTopoBbox] = useState<TBbox | null>(null);
  const [pendingExportBox, setPendingExportBox] = useState<TBbox | null>(null);
  // The box an opening was given (a selection's, a topo's).
  const [exportAreaSeed, setExportAreaSeed] = useState<TBbox | null>(null);
  // A new key for every opening that is not a pick coming back
  // (`freshExportDialog`), because a pick the dialog left for may never return:
  // another product can take the box tool over it. e2e/export-area.spec.ts (run
  // in CI; App has no render harness) holds the mechanism through its Map tools
  // caller.
  const [exportDialogKey, setExportDialogKey] = useState(0);
  // Topo job tracking (lifted from TopoDialog so polling survives dialog close)
  const [activeTopoJobs, setActiveTopoJobs] = useState<TopoJob[]>([]);
  const [topoFlyTarget, setTopoFlyTarget] = useState<GeoJsonPolygonal | null>(
    null,
  );
  const auth = useAuth();
  const authenticated = auth.state === "authenticated";
  const { hydrateFromUser } = useThemePreferences();
  const {
    currentUser,
    error: currentUserError,
    refetchCurrentUser,
    applyCurrentUser,
  } = useCurrentUser(authenticated);
  const slopeBands = useSlopeBands(currentUser, applyCurrentUser);
  // `authenticated` is NOT enough to start fetching the user's data: a user
  // whose recorded consent is stale gets ConsentGate rendered instead of
  // Logjam Web, and user data must not load behind the gate (frontend/AGENTS.md).
  // `loadsUserData` is what they wait on.
  //
  // `useCurrentUser` above and `useAuth` are the two that cannot: they are how
  // the answer arrives. Everything downstream of them gates on this instead.
  const { blocked: consentBlocked, settled: consentSettled } =
    consentGate(currentUser);
  const loadsUserData = authenticated && consentSettled;
  // All of the user's completed LiDAR jobs (with presigned URLs), forgotten
  // on signing out (useCompletedTopoJobs.ts).
  const {
    jobs: completedTopoJobs,
    loaded: completedTopoJobsLoaded,
    refetch: refetchCompletedTopoJobs,
  } = useCompletedTopoJobs(loadsUserData, authenticated);
  // One toast for the whole session, however many vegetation sources fail.
  const topoUnavailableToastShownRef = useRef(false);

  // GeoPDF dialog
  const [showGeoPdf, setShowGeoPdf] = useState(false);
  const [selectingGeoPdfExtent, setSelectingGeoPdfExtent] = useState(false);
  // The base layer the GeoPDF will be printed from, handed over when the area is
  // framed: the map shows it for as long as the framing lasts, and the user's
  // own stored layer (`activeLayerId`) is never written (`mapLayerFor`).
  const [geoPdfFramingLayer, setGeoPdfFramingLayer] = useState<string | null>(
    null,
  );
  // What the map actually draws: the user's layer, except while a GeoPDF's area
  // is framed on the base layer it will be printed from.
  const mapLayerId = mapLayerFor(activeLayerId, {
    active: selectingGeoPdfExtent,
    layerId: geoPdfFramingLayer,
  });

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

  // Place fly-to target
  const [flyToPlace, setFlyToPlace] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // OPENING A PLACE SHOWS IT ON THE MAP (UX §3). Every way to open a place's
  // page ends in this setter (a row, a pin, a search hit, an inbox item, a
  // linked place), so the fly-to lives here once rather than beside each
  // caller. It runs on a repeat open of the same place too, which an effect
  // keyed on the id would miss after the user had panned away. Closing (null)
  // leaves the camera alone.
  const allPlacesRef = useRef<TPlace[]>([]);
  const setSelectedPlaceID = useCallback((id: string | null) => {
    setSelectedPlaceIDRaw(id);
    const target = id && allPlacesRef.current.find((p) => p.id === id);
    if (target) setFlyToPlace({ lat: target.latitude, lng: target.longitude });
  }, []);

  // A sharpened area's optional vegetation layer: every area's, newest first
  // so a newer survey draws over an older one, while the Terrain switch is on.
  const vegetationLayers = useMemo(() => {
    if (!terrainLayers.vegetation) return [];
    // Credit the layer's open-data sources (ELVIS / SVTM) so MapLibre's
    // AttributionControl surfaces the required CC BY / ODbL attribution.
    const attribution = (
      TOPO_OVERLAY_SOURCE as Record<string, OverlaySource[] | undefined>
    ).vegetation
      ?.map((s) => GEOPDF_OVERLAY_ATTRIBUTION[s])
      .join(" · ");
    return completedTopoJobs.flatMap((job) => {
      const match = job.layers.find((l) => l.name === "vegetation");
      return match
        ? [
            {
              id: `${job.jobId}-vegetation`,
              pmtilesUrl: match.pmtilesUrl,
              format: match.format,
              attribution,
            },
          ]
        : [];
    });
  }, [terrainLayers.vegetation, completedTopoJobs]);

  // The Terrain group rides the same list, bottom first and underneath every
  // topo area's own layers, so the Map draws and styles it with the code it has.
  const { contours, slope, land, hillshade } = terrainLayers;
  const sharpenedAreas = useMemo(
    () => completedTopoJobs.flatMap((job) => job.sharpened ?? []),
    [completedTopoJobs],
  );
  const mapTopoLayers = useMemo(() => {
    // Here, not in an effect: the Map's effects run before this component's,
    // and its routed sources ask for tiles as soon as it adds them.
    setRoutedAreas(sharpenedAreas);
    const entries = terrainEntries(sharpenedAreas);
    const shown = {
      contours: drawsNswContours(activeLayerId, contours),
      slope,
      land,
      hillshade: drawsNswHillshade(activeLayerId, hillshade),
    };
    return [
      ...[...TERRAIN_LAYER_KEYS]
        .reverse()
        .filter((key) => shown[key])
        .map((key) => entries[key]),
      ...vegetationLayers,
    ];
  }, [
    activeLayerId,
    contours,
    slope,
    land,
    hillshade,
    vegetationLayers,
    sharpenedAreas,
  ]);

  // A PMTiles source failed to load (Map already tore it down to stop the
  // retry spam). Tell the user once.
  const handleTopoSourceUnavailable = useCallback(
    (entryId: string) => {
      // A Terrain layer's switch is on, so say which one draws nothing. Only
      // a reload retries it: the pmtiles protocol keeps the failed header for
      // the page's life.
      const terrainKey = TERRAIN_LAYER_KEYS.find(
        (key) => TERRAIN_ENTRIES[key].id === entryId,
      );
      if (terrainKey) {
        toast.error(
          `${MAP_TERRAIN.copy[terrainKey]} couldn't be loaded — its map file is missing.`,
        );
        return;
      }
      if (!topoUnavailableToastShownRef.current) {
        topoUnavailableToastShownRef.current = true;
        toast.error(
          `${MAP_TERRAIN.copy.vegetation} couldn't be loaded for some sharpened areas — their map files are missing.`,
        );
      }
    },
    [toast],
  );

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
   * them in state would re-render App on every pan for a value nothing
   * renders.
   */
  const mapBoundsRef = useRef<TBbox | null>(null);

  const startFilterAreaSelection = useCallback(() => {
    setActivePanel(null);
    setSelectingFilterArea(true);
  }, []);

  const cancelFilterAreaSelection = useCallback(() => {
    setSelectingFilterArea(false);
  }, []);

  // Reflect the active panel in the document title (WCAG 2.4.2 Page Titled).
  useEffect(() => {
    document.title = activePanel
      ? `${PANEL_TITLES[activePanel]} — Logjam Web`
      : "Logjam Web";
  }, [activePanel]);

  // Leaving a detail page via the NavRail drops what it was showing.
  const handlePanelChange = useCallback((panel: PanelId | null) => {
    if (panel !== "place-detail") {
      setSelectedPlaceID(null);
    }
    if (panel !== "trip-detail") {
      setSelectedTripLogId(null);
    }
    if (panel !== "plan-detail") {
      setSelectedPlanId(null);
    }
    setActivePanel(panel);
  }, []);

  // When closing the panel
  const handlePanelClose = useCallback(() => {
    if (activePanel === "place-detail") {
      setSelectedPlaceID(null);
    }
    if (activePanel === "trip-detail") {
      setSelectedTripLogId(null);
    }
    if (activePanel === "plan-detail") {
      setSelectedPlanId(null);
    }
    setActivePanel(null);
  }, [activePanel]);

  // The view a plan opens on (a join request opens on People, where it is
  // answered), and whether it opens as an invite's preview: said by whoever
  // opens it, since the plans list may not know of an invite yet.
  const [planView, setPlanView] = useState<TripPlanPageView>("writeUp");
  const [planInvited, setPlanInvited] = useState(false);
  const [planAddCopy, setPlanAddCopy] = useState<{
    kind: TripPlanItemKind;
    id: string;
  } | null>(null);
  const consumePlanAddCopy = useCallback(() => setPlanAddCopy(null), []);
  const openPlan = useCallback(
    (planId: string, view: TripPlanPageView = "writeUp", invited = false) => {
      setSelectedPlanId(planId);
      setPlanView(view);
      setPlanInvited(invited);
      setActivePanel("plan-detail");
    },
    [],
  );
  const {
    places,
    total: placesTotal,
    loaded: placesLoaded,
    error: placesError,
    refetch,
  } = usePlaces(loadsUserData);
  const {
    plans,
    loaded: plansLoaded,
    error: plansError,
    refetch: refetchPlans,
  } = usePlans(loadsUserData);
  const planPreviewed =
    selectedPlanId != null &&
    opensPreview(
      planInvited,
      plans.find((plan) => plan.id === selectedPlanId)?.status,
    );
  // The open plan's full fetch: its page renders from it, and while it is
  // open the map draws its places and ways instead of the user's own.
  const planFetch = usePlan(
    loadsUserData && activePanel === "plan-detail" && !planPreviewed
      ? selectedPlanId
      : null,
    toast.error,
  );
  const planOnMap = planFetch.view;
  const planMapPlaces = useMemo<TPlace[]>(
    () => planOnMap?.places.map((place) => ({ ...place, ownerId: "" })) ?? [],
    [planOnMap],
  );
  const planMapRoutes = useMemo<TRoute[]>(
    () => planOnMap?.routes.map((route) => ({ ...route, ownerId: "" })) ?? [],
    [planOnMap],
  );
  const {
    places: sharedPlaces,
    error: sharedError,
    refetch: refetchShared,
  } = useSharedPlaces(loadsUserData);
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
  // The "Ways" overlay draws them. Presigned URLs are minted only for what is
  // actually drawn, so the egress gate on POST /media/download-urls is
  // unchanged.
  const {
    files: standaloneFiles,
    loaded: standaloneFilesLoaded,
    error: standaloneFilesError,
    refetch: refetchStandaloneFiles,
  } = useStandaloneFiles(
    // A plan's page offers them to Add a place or way, whatever the Ways layer says.
    loadsUserData &&
      (activePanel === "ways" || activePanel === "plan-detail" || showWays),
  );
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
  const {
    routes,
    loaded: routesLoaded,
    refetch: refetchRoutes,
  } = useRoutes(
    loadsUserData &&
      (showWays ||
        drawingRoute ||
        activePanel === "ways" ||
        activePanel === "plan-detail"),
  );
  // Beside a plan the user's own are drawn as the layer switches allow, all
  // dimmed beside the plan's.
  const mineShown = {
    places: !planOnMap || showPlaces,
    ways: !planOnMap || showWays,
  };
  const mutedIds = useMemo<ReadonlySet<string>>(
    () =>
      planOnMap
        ? new Set([
            ...places.map((place) => place.id),
            ...sharedPlaces.map((place) => place.id),
            ...routes.map((route) => route.id),
            ...standaloneFiles.map((file) => file.id),
          ])
        : new Set(),
    [planOnMap, places, sharedPlaces, routes, standaloneFiles],
  );
  // One of the user's own things pressed on the map asks for Add a place or way,
  // only while the page itself offers it (not on an archived plan).
  const pressInPlan = (press: Parameters<typeof planMapPress>[0]) => {
    const pick = planMapPress(
      press,
      { places, routes, files: standaloneFiles, tracks: placeTracks },
      currentUser?.id ?? null,
    );
    if (
      pick &&
      planOnMap &&
      planVerbsFor(PLAN_ADD_VERBS, "web", planOnMap.myRole, {
        archived: planOnMap.archivedAt != null,
      }).some((verb) => verb.id === "copy")
    )
      setPlanAddCopy(pick);
  };

  // Ways is built from three fetches, so it has nothing to say until all three
  // have settled — one still in flight would show a short list as if it were
  // the whole list (shared/DESIGN.md §11).
  const waysLoaded = routesLoaded && standaloneFilesLoaded && placeTracksLoaded;

  /** The places shared WITH the user. What tells a route shared on its own from
   *  one seen through somebody's place, which decides the verbs it offers. */
  const sharedPlaceIds = useMemo(
    () => new Set(sharedPlaces.map((place) => place.id)),
    [sharedPlaces],
  );

  // The overlay's count is the SAME list the Ways page builds — including its
  // de-duplication of a file that both endpoints return — so the number on the
  // layer row and the number in the page's heading cannot drift. A line pressed
  // on the map is looked up in it too, so a line opens the page its row does.
  const allWays = useMemo(
    () =>
      buildWays({
        routes,
        standaloneFiles,
        placeTracks,
        currentUserId: currentUser?.id ?? null,
        sharedPlaceIds,
      }),
    [routes, standaloneFiles, placeTracks, currentUser?.id, sharedPlaceIds],
  );
  const wayCount = allWays.length;

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

  // Trip-log definitions, read from the same row-grain endpoint as the place
  // ones. A trip field carries scoping too (`tripTypes`, the trip's own tags),
  // and reading both the same way means one
  // shape reaches every dialog instead of two.
  const [customFieldDefs, setCustomFieldDefs] = useState<
    ScopedCustomFieldDef[]
  >([]);
  // The types a place can be filed under. ALL of them, including empty ones:
  // the tab bar and the layers list hide a type with no places, but the create
  // dialog must offer every one or a user could never make their first canyon.
  const [placeTypes, setPlaceTypes] = useState<TPlaceType[]>([]);

  // Surface background data-load errors as toasts
  useEffect(() => {
    if (placesError) toast.error(placesError);
  }, [placesError, toast]);
  useEffect(() => {
    if (currentUserError) toast.error(currentUserError);
  }, [currentUserError, toast]);
  useEffect(() => {
    if (sharedError) toast.error(sharedError);
  }, [sharedError, toast]);
  useEffect(() => {
    if (friendsError) toast.error(friendsError);
  }, [friendsError, toast]);
  useEffect(() => {
    if (notificationsError) toast.error(notificationsError);
  }, [notificationsError, toast]);
  useEffect(() => {
    if (tripLogsError) toast.error(tripLogsError);
  }, [tripLogsError, toast]);
  // A first load that fails is said by Plans itself (its ErrorState); only
  // a later refetch's failure, under a list already shown, is a toast.
  const plansBackgroundError = plans.length > 0 ? plansError : null;
  useEffect(() => {
    if (plansBackgroundError) toast.error(plansBackgroundError);
  }, [plansBackgroundError, toast]);

  useBootDefinitions(
    loadsUserData,
    setPlaceCustomFieldDefs,
    setCustomFieldDefs,
    setPlaceTypes,
  );
  useEffect(() => {
    if (!authenticated) return;
    // hydrateFromUser stays here: it only re-reads /users/me (the gate's own
    // request) for the theme, and the gate itself is themed by it.
    // Best-effort: hydration prefetch for the map/sidebar; UI degrades
    // gracefully (panels show their own empty/error states) if this fails.
    hydrateFromUser().catch(console.error);
    fetchCurrentUser().catch((err) => {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't load your preferences."));
    });
  }, [authenticated, hydrateFromUser, toast]);

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
      .catch((err) => {
        console.error(err);
      });
  }, [loadsUserData]);

  // Topo exports (Stage 2 on-demand pipeline). Owned at App level so the
  // auto-download on completion works regardless of which panel or dialog is
  // open. The hook self-throttles: it only polls while an export is in
  // progress.
  const {
    exports: topoExports,
    loading: topoExportsLoading,
    refetch: refetchTopoExports,
  } = useTopoExports(loadsUserData);

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
        if (ex.status === "completed")
          alreadyCompletedExportIds.current.add(ex.id);
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

  // The dialog owns the success surface (in-dialog "Submitted" view) and its
  // own close, so no toast/close here.
  const handleTopoJobCreated = useCallback(
    (job: TopoJob) =>
      routeMadeTopoJob(job, {
        track: (made) => setActiveTopoJobs((prev) => [made, ...prev]),
        finished: () => {
          refetchCompletedTopoJobs();
          refetchNotifications();
        },
      }),
    [refetchCompletedTopoJobs, refetchNotifications],
  );

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

  // Capture completion-email deep links on mount (?topoJob / ?export), stash
  // in sessionStorage so they survive a Cognito sign-in redirect, then clean
  // the URL once.
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
  // (mirrors NotificationsPanel.handleDownloadExport). An export that has
  // expired (the API says so, 404) opens the Inbox with that as the toast.
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
          setActivePanel("inbox");
          toast.error(
            view.status === "failed"
              ? (view.errorMessage ?? "That export couldn't be made.")
              : "That export isn't ready yet. It comes to your Inbox when it is.",
          );
        }
      })
      .catch((err) => {
        console.error(err);
        setActivePanel("inbox");
        toast.error(messageFromError(err, "Couldn't load the export."));
      });
  }, [loadsUserData, toast]);

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
  // needs a load that SUCCEEDED and came back empty.
  // Checked during render, the first time the places have loaded.
  if (placesLoaded && !importChecked) {
    setImportChecked(true);
    if (!placesError && places.length === 0) {
      setShowOnboarding(true);
    }
  }

  // Derived values
  const allPlaces = [...places, ...sharedPlaces];
  useEffect(() => {
    allPlacesRef.current = allPlaces;
  });
  const filteredPlaces = useMemo(
    () => [
      ...places.filter((c) => passesFilters(c, filters, true)),
      ...sharedPlaces.filter((c) => passesFilters(c, filters, false)),
    ],
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
    // The tool is a PAGE, so leaving it has to go somewhere: back to the way
    // being edited, or to the list a new route came from. A save calls this
    // too and then opens the saved way, which wins.
    setActivePanel(
      editingRouteId && selectedWay?.id === editingRouteId
        ? "way-detail"
        : "ways",
    );
    afterRouteCancel.current?.();
    afterRouteCancel.current = null;
  };

  // Discard guard for in-progress route drawing/editing (the same discard-guard
  // the dialogs use for unsaved changes).
  //
  // These two sit ABOVE the loading/unauthenticated early returns below: a
  // hook after an early return runs on some renders and not others, so the
  // sign-in -> map transition would shift every later hook's slot.
  // "Dirty" for a NEW route is any point placed; for an EDIT it is the geometry
  // differing from what was opened.
  const editingOriginal = editingRouteId
    ? (routes.find((route) => route.id === editingRouteId) ?? null)
    : null;
  const draftChanged = editingOriginal
    ? JSON.stringify(routeDraft.points) !==
      JSON.stringify(editingOriginal.points)
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
        error={auth.error}
        onRedirect={auth.signIn}
        onPasswordSignIn={auth.signInWithPassword}
      />
    );
  }

  const selectedRoute =
    selectedWay?.kind === "route"
      ? (routes.find((r) => r.id === selectedWay.id) ?? null)
      : null;

  /**
   * Open a way's own page, and centre the map on it.
   *
   * Opening and centring are ONE action: a page describing a line while the map
   * shows somewhere else is two halves of an answer.
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

  /**
   * Arm the measure tool, from `from` when a point asked for it. A measurement
   * is not kept, so arming it over another measurement asks nothing; over a
   * route being drawn it goes through that tool's own discard confirm first,
   * as it does on Logjam GPS.
   */
  const startMeasuring = (from?: MapPointCoord) => {
    const arm = () => {
      routeDraft.reset();
      if (from) routeDraft.addAnchor([from.longitude, from.latitude]);
      setActivePanel("measure");
    };
    if (!drawingRoute) return arm();
    afterRouteCancel.current = arm;
    cancelRouteGuard.requestClose();
  };

  const startEditingRoute = (route: TRoute) => {
    setEditingRouteId(route.id);
    // Anchors come back with the route, so a snapped line reopens with the
    // user's own handful of points rather than every snapped vertex.
    routeDraft.reset({ points: route.points, anchors: route.anchors });
    setDrawColor(route.color ?? pickNextTrackColor(routes.map((r) => r.color)));
    setDrawingRoute(true);
    // Editing centres it too: the points being edited must be on screen.
    const bounds = wayFromRoute(
      route,
      currentUser?.id ?? null,
      sharedPlaceIds,
    ).bounds;
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

  // Blocking re-consent gate: a signed-in user whose recorded consent version
  // is stale or absent must re-consent before using Logjam Web (the
  // privacy.html / tos.html "re-consent on next sign-in" promise). A new
  // account lands here too and answers the questions the provider's sign-up
  // page cannot ask.
  // Decided once, up beside the data hooks the same answer holds back
  // (`consentGate`), so the gate and the fetches can never disagree.
  if (consentBlocked && currentUser) {
    return (
      <ConsentGate
        consentVersion={currentConsentVersionOf(currentUser)}
        newAccount={currentUser.consentVersion === null}
        currentUsername={currentUser.username}
        onAccepted={applyCurrentUser}
        onSignOut={signOut}
      />
    );
  }

  const dimUI =
    pickingCoords ||
    selectingFilterArea ||
    selectingGeoPdfExtent ||
    boxPickDimsUI(boxPick);

  // A filter changes what the MAP shows too, so the map says so while the
  // Places page is closed or scrolled away.
  // While a plan is open the map shows it, and says so first.
  const backToMyMap = () => {
    setSelectedPlanId(null);
    setActivePanel(null);
  };
  const notices = planOnMap ? (
    <Notice
      icon="plan"
      twoLines
      action={
        <IconButton
          icon="close"
          label={TRIP_PLAN_PAGE.copy.backToMap}
          size={14}
          round
          onClick={backToMyMap}
        />
      }
    >
      {`${TRIP_PLAN_PAGE.copy.barPrefix} ${planOnMap.name}`}
    </Notice>
  ) : filtersActive && !dimUI ? (
    <Notice
      icon="filter"
      action={
        <IconButton
          icon="close"
          label="Clear filters"
          size={14}
          round
          onClick={clearFilters}
        />
      }
    >
      Showing {filteredPlaces.length} of {allPlaces.length} places
    </Notice>
  ) : null;

  // Opening Export an area anew: no stale form, and no pick result from last time.
  const freshExportDialog = () => {
    setExportDialogKey((key) => key + 1);
    setPendingGeoPdfExtent(null);
    setPendingGeoPdfScale(null);
    setPendingExportBox(null);
    setExportAreaSeed(null);
  };

  // "Make a map" from Places: the selection's bounds prefill the chosen product.
  // A topo goes straight to its dialog with the box; an export opens a GeoPDF's
  // paper frame on the map over the box, because the paper decides the final
  // extent, and keeps the box for a GIS format.
  const makeMap = (bounds: TBbox, kind: MapKind) => {
    if (kind === "topo") {
      setPendingTopoBbox(bounds);
      setShowTopo(true);
      return;
    }
    freshExportDialog();
    setExportAreaSeed(bounds);
    setBoxPick((pick) => endBox(pick, "export"));
    setGeoPdfPaperAspect(210 / 297);
    setGeoPdfPaperDimensions({ w: 210, h: 297 });
    setGeoPdfInitialExtent(bounds);
    setGeoPdfInitialScale(undefined);
    // No dialog has chosen yet: it will open on the layer it seeds from the
    // map's, so that is the one the frame is drawn on.
    setGeoPdfFramingLayer(seedBaseLayer(activeLayerId));
    setActivePanel(null);
    setSelectingGeoPdfExtent(true);
  };

  // Verbs that START on the map, in Logjam GPS's order for the two it has.
  const mapTools: MapTool[] = [
    {
      id: "measure",
      label: MAP_MEASURE.title,
      icon: MAP_MEASURE_ICON,
      onSelect: () => startMeasuring(),
    },
    {
      id: "route",
      label: "Draw a route",
      icon: "draw",
      onSelect: startDrawingRoute,
    },
    {
      id: "place",
      label: "Add a place",
      icon: "addPlace",
      onSelect: () => setShowAdd(true),
    },
    {
      id: "make-map",
      label: "Make a map",
      icon: "pickArea",
      menu: [
        {
          id: "topo",
          label: LIDAR_JOB_COPY.make,
          icon: "lidar",
          onSelect: () => {
            setActivePanel(null);
            setBoxPick((pick) => armBox(pick, "topo"));
          },
        },
        {
          id: "export",
          label: "Export an area",
          icon: "export",
          onSelect: () => {
            setBoxPick((pick) => endBox(pick, "export"));
            freshExportDialog();
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
    selectingTopoBbox ||
    selectingExportBox;

  return (
    <CurrentUserIdContext.Provider value={currentUser?.id ?? null}>
      <div className={classes.app}>
        <a href="#main-content" className={classes.skipLink}>
          Skip to map
        </a>
        <TopoDialog
          open={showTopo}
          onClose={() => {
            setShowTopo(false);
            setBoxPick((pick) => endBox(pick, "topo"));
            // The dialog empties itself on a real close; the drawn area is held
            // out here (going off to draw closes the dialog), so it has to be
            // emptied with it or the next topo starts with the last one's box.
            setPendingTopoBbox(null);
          }}
          onSelectBbox={() => {
            setShowTopo(false);
            setBoxPick((pick) => armBox(pick, "topo"));
          }}
          awaitingBbox={selectingTopoBbox}
          pendingBbox={pendingTopoBbox}
          onJobCreated={handleTopoJobCreated}
          existingTopoNames={[...activeTopoJobs, ...completedTopoJobs]
            .map((j) => j.name)
            .filter((n): n is string => !!n)}
        />
        <GeoPdfDialog
          key={exportDialogKey}
          open={showGeoPdf}
          onClose={() => {
            setShowGeoPdf(false);
            setExportAreaSeed(null);
            setPendingExportBox(null);
            setBoxPick((pick) => endBox(pick, "export"));
          }}
          onSelectOnMap={(aspect, paperDims, extent, scale, baseLayerId) => {
            // The latest pick, every visit: the map follows the dialog.
            setGeoPdfFramingLayer(baseLayerId ?? null);
            setGeoPdfPaperAspect(aspect);
            setGeoPdfPaperDimensions(paperDims);
            setGeoPdfInitialExtent(extent);
            setGeoPdfInitialScale(scale);
            setShowGeoPdf(false);
            setActivePanel(null);
            setBoxPick((pick) => endBox(pick, "export"));
            setSelectingGeoPdfExtent(true);
          }}
          pendingExtent={pendingGeoPdfExtent}
          pendingScale={pendingGeoPdfScale}
          activeLayerId={activeLayerId}
          terrainLayers={terrainLayers}
          completedTopoJobs={completedTopoJobs}
          mapCenter={mapCenter}
          places={places}
          sharedPlaces={sharedPlaces}
          slopeBands={slopeBands.drawn}
          topoJobsLoaded={completedTopoJobsLoaded}
          areaSeed={exportAreaSeed}
          onPickArea={() => {
            setShowGeoPdf(false);
            setActivePanel(null);
            setBoxPick((pick) => armBox(pick, "export"));
          }}
          pendingArea={pendingExportBox}
          onExportQueued={refetchTopoExports}
          sharpenedAreas={sharpenedAreas}
        />
        <div className={dimUI ? classes.dimmed : undefined}>
          <NavRail
            activePanel={activePanel}
            onPanelChange={handlePanelChange}
            badgeCounts={{
              inbox: unreadCount,
              plans: tripPlansBadgeCount(plans),
            }}
          />
          <SidebarPanel
            activePanel={activePanel}
            onClose={handlePanelClose}
            onTopoFlyTarget={setTopoFlyTarget}
            onShowSharpened={() => {
              setLayersStartView({ view: "sharpened" });
              setLayersOpen(true);
            }}
            logsView={logsView}
            onLogsViewChange={setLogsView}
            onStartDrawingRoute={startDrawingRoute}
            waysLoaded={waysLoaded}
            allRoutes={routes}
            placeTracks={placeTracks}
            standaloneFiles={standaloneFiles}
            standaloneFilesError={standaloneFilesError}
            onRetryStandaloneFiles={refetchStandaloneFiles}
            onOpenWay={openWay}
            currentUserId={currentUser?.id ?? null}
            wayDetail={
              selectedWay ? (
                <WayDetailPanel
                  way={selectedWay}
                  route={selectedRoute}
                  file={
                    standaloneFiles.find(
                      (each) => each.id === selectedWay.id,
                    ) ?? null
                  }
                  placeTrack={
                    placeTracks.find(
                      (each) => each.mediaId === selectedWay.id,
                    ) ?? null
                  }
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
                  onEdit={startEditingRoute}
                  onCopied={showCopiedRoute}
                  onChanged={() => {
                    refetchRoutes();
                    refetchStandaloneFiles();
                    // A file linked to a place is drawn by the place-tracks layer
                    // too, from its own copy of the colour.
                    refetchPlaceTracks();
                  }}
                  onOpenPlace={(placeId) => {
                    setSelectedPlaceID(placeId);
                    setActivePanel("place-detail");
                  }}
                  onLogTrip={setLogTripFromTrack}
                  onDeleteFile={handleDeleteStandaloneFile}
                  routeHover={routeHover}
                />
              ) : null
            }
            plansPanel={
              <PlansPanel
                plans={plans}
                loaded={plansLoaded}
                error={plansError}
                onRefetch={refetchPlans}
                onOpenPlan={(id, invited) => openPlan(id, "writeUp", invited)}
              />
            }
            onOpenPlan={(target) => {
              refetchPlans();
              openPlan(target.planId, target.view, target.invited);
            }}
            planDetail={
              selectedPlanId && planPreviewed ? (
                <PlanInvitedPage
                  key={selectedPlanId}
                  planId={selectedPlanId}
                  onBack={() => {
                    setSelectedPlanId(null);
                    setActivePanel("plans");
                  }}
                  onJoined={() => {
                    refetchPlans();
                    setPlanInvited(false);
                  }}
                  onDeclined={() => {
                    refetchPlans();
                    setSelectedPlanId(null);
                    setActivePanel("plans");
                  }}
                />
              ) : selectedPlanId ? (
                <PlanDetailPanel
                  myUserId={currentUser?.id ?? null}
                  initialView={planView}
                  key={selectedPlanId}
                  view={planFetch.view}
                  error={planFetch.error}
                  gone={planFetch.gone}
                  name={plans.find((plan) => plan.id === selectedPlanId)?.name}
                  refetch={planFetch.refetch}
                  own={{
                    places,
                    routes,
                    files: standaloneFiles,
                  }}
                  currentUser={currentUser}
                  onOwnChanged={() => {
                    refetch();
                    refetchRoutes();
                    refetchStandaloneFiles();
                    refetchCurrentUser();
                  }}
                  onOpenItem={(item) => {
                    if (item.kind === "place")
                      setFlyToPlace({
                        lat: item.latitude,
                        lng: item.longitude,
                      });
                    else if (item.kind === "route") {
                      const bounds = boundsOfPoints(item.points);
                      if (bounds) setFlyToBounds(bounds);
                    }
                  }}
                  addCopyRequest={planAddCopy}
                  onAddCopyRequestConsumed={consumePlanAddCopy}
                  onBack={() => {
                    setSelectedPlanId(null);
                    setActivePanel("plans");
                  }}
                  onPlansChanged={refetchPlans}
                  onStartTripLog={(plan, places) =>
                    setTripLogPrefill({
                      ...tripPlanTripLogPrefill(plan),
                      ...places,
                    })
                  }
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
                  editingName={
                    routes.find((r) => r.id === editingRouteId)?.name ?? null
                  }
                  color={drawColor}
                  onColorChange={setDrawColor}
                  onUndo={routeDraft.undo}
                  onClear={clearRouteGuard.requestClose}
                  onReverse={routeDraft.reverse}
                  routeHover={routeHover}
                  // Editing keeps the name it already has; naming belongs to
                  // CREATING a route.
                  onSave={() => {
                    const existing = routes.find(
                      (r) => r.id === editingRouteId,
                    );
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
            measurePanel={
              measuring ? (
                <MeasurePanel
                  points={routeDraft.points}
                  anchorCount={routeDraft.draft.anchors.length}
                  canUndo={routeDraft.canUndo}
                  atCap={routeDraft.atCap}
                  onUndo={routeDraft.undo}
                  onClear={() => routeDraft.reset()}
                  onClose={() => setActivePanel(null)}
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
            onQuotaChanged={refetchCurrentUser}
            currentUser={currentUser}
            currentUserError={currentUserError}
            onRetryCurrentUser={refetchCurrentUser}
            onCurrentUserChange={applyCurrentUser}
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
            selectedTripLogId={selectedTripLogId}
            setSelectedTripLogId={setSelectedTripLogId}
            tripLogsTotal={tripLogsTotal}
            tripLogsLoaded={tripLogsLoaded}
            onRefetchTripLogs={refetchAfterTripWrite}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={setCustomFieldDefs}
            placeCustomFieldDefs={placeCustomFieldDefs}
            onPlaceCustomFieldDefsChange={setPlaceCustomFieldDefs}
            placeTypes={placeTypes}
            onPlaceTypesChange={setPlaceTypes}
            collapseToPeek={mapInteractionActive}
          />
        </div>
        <main id="main-content" className={classes.main}>
          <h1 className={classes.visuallyHidden}>Logjam place map</h1>
          <Map
            filters={planOnMap ? emptyFilters : filters}
            // An open plan's things are drawn whatever the layer switches say;
            // the switches go on deciding the user's own, shown beside them
            // dimmed (`mutedIds`).
            places={
              planOnMap
                ? [...planMapPlaces, ...(mineShown.places ? places : [])]
                : places
            }
            sharedPlaces={!planOnMap || mineShown.places ? sharedPlaces : []}
            showPlaces={showPlaces || !!planOnMap}
            // One overlay for every line, so nothing has to be partitioned by
            // ownership on the way to the map any more.
            showWays={showWays || !!planOnMap}
            showGauges={showGauges}
            onShowGauges={() => setShowGauges(true)}
            placeTracks={!planOnMap || mineShown.ways ? placeTracks : []}
            standaloneTracks={
              !planOnMap || mineShown.ways ? standaloneTracks : []
            }
            routes={
              planOnMap
                ? [...planMapRoutes, ...(mineShown.ways ? routes : [])]
                : routes
            }
            mutedIds={mutedIds}
            searchSelects={!planOnMap}
            routeHover={routeHover}
            selectRoute={(id) => {
              if (planOnMap) return pressInPlan({ kind: "route", id });
              const route = routes.find((r) => r.id === id);
              if (route)
                openWay(
                  wayFromRoute(route, currentUser?.id ?? null, sharedPlaceIds),
                );
            }}
            onAddPlaceAt={(point) => {
              setAddPlaceAt(point);
              setShowAdd(true);
            }}
            // The point is the measurement's first, as a press on the map there
            // would have made it.
            onMeasureFrom={startMeasuring}
            selectTrack={(mediaId) => {
              if (planOnMap) return pressInPlan({ kind: "track", id: mediaId });
              const way = allWays.find(
                (each) => each.kind !== "route" && each.id === mediaId,
              );
              if (way) openWay(way);
            }}
            drawingRoute={drawingRoute || measuring}
            measuring={measuring}
            // A measurement has no colour of its own: it draws in the accent.
            drawColor={measuring ? undefined : (drawColor ?? undefined)}
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
              if (planOnMap) {
                if (id) pressInPlan({ kind: "place", id });
                return;
              }
              // A pin opens the place, wherever you pressed it from.
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
            }}
            selectingBbox={boxFor(boxPick) !== null}
            onBboxSelected={(bbox) => {
              if (boxFor(boxPick) === "export") {
                setPendingExportBox(bbox);
                setBoxPick((pick) => endBox(pick, "export"));
                setShowGeoPdf(true);
                return;
              }
              setPendingTopoBbox(bbox);
              setBoxPick((pick) => endBox(pick, "topo"));
              setShowTopo(true);
            }}
            onBboxCancelled={
              boxFor(boxPick) === "export"
                ? () => {
                    setBoxPick((pick) => endBox(pick, "export"));
                    setShowGeoPdf(true);
                  }
                : undefined
            }
            topoLayers={mapTopoLayers}
            sharpenedAreas={sharpenedAreas}
            slopeBands={slopeBands.drawn}
            activeLayerId={mapLayerId}
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
                icon="layers"
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
          onImportFile={() => setShowUnifiedImport(true)}
          open={layersOpen}
          onClose={() => setLayersOpen(false)}
          anchorRef={layersButtonRef}
          startView={layersStartView}
          sharpenedLoaded={completedTopoJobsLoaded}
          activeTopoJobs={activeTopoJobs}
          friends={friends}
          onSharpen={() => setShowTopo(true)}
          onExportArea={(job) => {
            const bounds = job.footprint && footprintBounds(job.footprint);
            if (bounds) makeMap(bounds, "geopdf");
          }}
          onFlyToArea={setTopoFlyTarget}
          onRefetchCompletedTopoJobs={refetchCompletedTopoJobs}
          onDismissActiveJob={handleDismissActiveTopoJob}
          onQuotaChanged={refetchCurrentUser}
          showPlaces={showPlaces}
          setShowPlaces={setShowPlaces}
          showWays={showWays}
          setShowWays={setShowWays}
          showGauges={showGauges}
          setShowGauges={setShowGauges}
          placeCount={places.length + sharedPlaces.length}
          wayCount={showWays ? wayCount : null}
          completedTopoJobs={completedTopoJobs}
          baseLayers={BASE_LAYERS}
          activeLayerId={activeLayerId}
          onActiveLayerChange={setActiveLayerId}
          terrainLayers={terrainLayers}
          onTerrainLayerChange={setTerrainLayer}
          slopeBands={slopeBands.bands}
          onSlopeBandsChange={slopeBands.setBands}
          mapView={mapCenter}
        />

        <PlanInviteLinkDialog
          enabled={loadsUserData}
          onOpenPlan={(id, invited) => {
            refetchPlans();
            openPlan(id, "writeUp", invited);
          }}
          onShowPlans={() => {
            refetchPlans();
            handlePanelChange("plans");
          }}
        />
        <FriendInviteDialog
          enabled={loadsUserData}
          onFriended={() => {
            refetchFriends();
            // A request waiting between the two is accepted by the link, and
            // its Inbox row is gone on the server.
            refetchNotifications();
          }}
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
          onClose={() => {
            // Keeping the route also drops whatever was waiting on its discard.
            afterRouteCancel.current = null;
            cancelRouteGuard.cancelDiscard();
          }}
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
            <Button
              compact
              variant="filled"
              onClick={cancelFilterAreaSelection}
            >
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

        {/* The trip form, opened from a track's "Log a trip". Mounted only while
          it is open, so every open starts from the track it was asked for. */}
        {logTripFromTrack && (
          <TripLogDialog
            open={!pickingCoords}
            onClose={() => setLogTripFromTrack(null)}
            onSaved={() => {
              setLogTripFromTrack(null);
              refetchAfterTripWrite();
              refetchCurrentUser();
            }}
            places={places}
            fromTrack={logTripFromTrack}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={setCustomFieldDefs}
            existingTripTypes={tripLogs.flatMap((trip) => trip.types)}
            onPickCoords={startPickingCoords}
            onPlaceCreated={refetch}
          />
        )}

        {/* The trip form, opened from a plan's "Start a trip log". */}
        {tripLogPrefill && (
          <TripLogDialog
            open={!pickingCoords}
            onClose={() => setTripLogPrefill(null)}
            onSaved={() => {
              setTripLogPrefill(null);
              refetchAfterTripWrite();
              refetchCurrentUser();
            }}
            places={places}
            prefill={tripLogPrefill}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={setCustomFieldDefs}
            existingTripTypes={tripLogs.flatMap((trip) => trip.types)}
            onPickCoords={startPickingCoords}
            onPlaceCreated={refetch}
          />
        )}

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
          initialCoords={addPlaceAt}
          onClose={() => {
            setShowAdd(false);
            setAddPlaceAt(null);
          }}
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
          onRemovePlace={(id) =>
            setSelectedAreaPlaceIds((ids) => ids.filter((x) => x !== id))
          }
          onAddPlace={(id) =>
            setSelectedAreaPlaceIds((ids) =>
              ids.includes(id) ? ids : [...ids, id],
            )
          }
        />
      </div>
    </CurrentUserIdContext.Provider>
  );
}

export default App;
