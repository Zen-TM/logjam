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
import CanyonDialog from "./dialogs/CanyonDialog";
import UnifiedImportDialog from "./dialogs/UnifiedImportDialog";
import OnboardingChoiceDialog from "./dialogs/OnboardingChoiceDialog";
import SelectedCanyonsDialog from "./dialogs/SelectedCanyonsDialog";
import classes from "./App.module.css";
import type { TBbox } from "./map/Map";
import type { TFilters, TCanyon, GeoPdfJobView } from "../canyonUtils";
import type { PanelId } from "./sidebar/panels";
import { TOPO_LAYERS } from "../topoLayerTypes";
import type { CompletedTopoJob, CompletedOverlaysResponse } from "../topoLayerTypes";
import {
  useCanyons,
  useCanyonTracks,
  useRoutes,
  type TRoute,
  createRoute,
  updateRoute,
  useSharedCanyons,
  useFriends,
  useNotifications,
  useTripLogs,
  useAnalytics,
  useCurrentUser,
  useLiveVectorStyle,
  useTopoExports,
  useGeoPdfJobs,
  fetchCurrentUser,
  recordConsent,
  passesFilters,
  hasActiveFilters,
  emptyFilters,
  reconcileCustomFilters,
  apiFetch,
  getTopoExport,
} from "../canyonUtils";
import FilterStatusChip from "./map/FilterStatusChip";
import FilterEmptyState from "./map/FilterEmptyState";
import {
  CURRENT_CONSENT_VERSION,
  PENDING_CONSENT_STORAGE_KEY,
  needsReconsent,
} from "../consent";
import ConsentGate from "./ConsentGate";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import { RouteDrawPanel } from "./routes/RouteDrawPanel";
import RouteNameDialog from "./dialogs/RouteNameDialog";
import { TOPO_OVERLAY_SOURCE, GEOPDF_OVERLAY_ATTRIBUTION } from "@logjam/shared";
import type { OverlaySource } from "@logjam/shared";
import { useAuth } from "../useAuth";
import { useStoredState } from "../useStoredState";
import { Button } from "@mui/material";
import { useThemePreferences } from "../themePreferences";
import { useToast } from "./feedback/ToastProvider";
import { messageFromError } from "../errors/messageFromError";

// Programmatically trigger a browser download for a presigned URL.
function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function App() {
  const toast = useToast();
  // Session-scoped, like the search box beside it: every member of TFilters
  // hides canyons, and a filter the user set last month greets them as "my
  // canyons are missing" rather than as a favour (UX finding 5). The search box
  // moved for that reason while this — grades, ownership, completion, dates,
  // custom fields, the larger hider — was left on localStorage. Same principle,
  // same polarity. Sort order is the counter-example and stays in localStorage:
  // it reorders, it never hides. Survives the panel's unmount-on-close
  // (CANYON-12) without surviving the week.
  const [storedFilters, setFilters] = useStoredState<TFilters>(
    "logjam.filters",
    emptyFilters,
    sessionStorage,
  );
  // Declared here (not with the other field-def state below) because the filters
  // memo needs it to prune custom filters whose definition no longer exists.
  const [canyonCustomFieldDefs, setCanyonCustomFieldDefs] = useState<
    TripLogCustomFieldDef[]
  >([]);
  // Backfill defaults for any filter keys missing from older persisted state, so
  // new fields (ownership, ropewiki, date ranges, custom) never read as undefined,
  // then drop custom-field filters orphaned by a since-deleted definition.
  const filters = useMemo<TFilters>(
    () =>
      reconcileCustomFilters(
        { ...emptyFilters, ...storedFilters },
        canyonCustomFieldDefs,
      ),
    [storedFilters, canyonCustomFieldDefs],
  );
  const [filtersAccordionSignal, setFiltersAccordionSignal] = useState(0);
  const [selectedCanyonID, setSelectedCanyonID] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  // Vector by default: same OSM cartography as the old raster default, drawn
  // locally rather than fetched as pictures, and it carries the labels at every
  // zoom instead of stopping where the raster cache does.
  const [activeLayerId, setActiveLayerId] = useStoredState(
    "logjam.activeLayerId",
    "protomaps",
  );

  const [showAdd, setShowAdd] = useState(false);
  const [showUnifiedImport, setShowUnifiedImport] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // True when the unified importer was opened from the onboarding wizard, so its
  // Back/close returns to the welcome hub instead of dropping into an empty app.
  const [importedFromOnboarding, setImportedFromOnboarding] = useState(false);
  const importChecked = useRef(false);

  // Layer visibility toggles
  const [showOwnedCanyons, setShowOwnedCanyons] = useStoredState("logjam.showOwnedCanyons", true);
  const [showSharedCanyons, setShowSharedCanyons] = useStoredState("logjam.showSharedCanyons", true);
  const [showCanyonTracks, setShowCanyonTracks] = useStoredState("logjam.showCanyonTracks", false);
  const [showRoutes, setShowRoutes] = useStoredState("logjam.showRoutes", true);

  // Route draw/edit mode. The vertex list lives here (not in Map) so the HUD
  // can show the running distance and drive undo. `editingRouteId` is null
  // while drawing a new route.
  const [drawingRoute, setDrawingRoute] = useState(false);
  const routeDraft = useRouteDraft();
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [savingRoute, setSavingRoute] = useState(false);
  const [namingRoute, setNamingRoute] = useState(false);
  // Persisted: a canyoner who wants creek-following wants it every session.
  const [snapMode, setSnapMode] = useStoredState<SnapMode>(
    "logjam.snapMode",
    "off",
  );
  const [selectedRouteID, setSelectedRouteID] = useState<string | null>(null);
  // Position along the selected route under the elevation-profile cursor, so
  // the chart and the map point at the same place.
  const [routeHoverPosition, setRouteHoverPosition] = useState<
    [number, number] | null
  >(null);

  // Coordinate picking mode for CanyonDialog
  const [pickingCoords, setPickingCoords] = useState(false);
  const coordsCallbackRef = useRef<((lat: number, lng: number) => void) | null>(
    null,
  );

  // Area selection mode
  const [selectingArea, setSelectingArea] = useState(false);
  const [selectedAreaCanyonIds, setSelectedAreaCanyonIds] = useState<string[]>(
    [],
  );

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

  // Canyon fly-to target
  const [flyToCanyon, setFlyToCanyon] = useState<{ lat: number; lng: number } | null>(null);

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

  const startAreaSelection = useCallback(() => {
    setSelectingArea(true);
    setSelectedAreaCanyonIds([]);
  }, []);

  const handleAreaSelected = useCallback((ids: string[]) => {
    setSelectingArea(false);
    setSelectedAreaCanyonIds(ids);
  }, []);

  const cancelAreaSelection = useCallback(() => {
    setSelectingArea(false);
    setSelectedAreaCanyonIds([]);
  }, []);

  // Reflect the active panel in the document title (WCAG 2.4.2 Page Titled).
  useEffect(() => {
    const panelTitles: Record<PanelId, string> = {
      layers: "Layers",
      canyons: "Canyons",
      geopdfs: "GeoPDFs",
      lidar: "LiDAR",
      routes: "Routes",
      "trip-logs": "Trip Logs",
      analytics: "Analytics",
      friends: "Friends",
      notifications: "Alerts",
      account: "Account",
      "canyon-detail": "Canyon",
      "route-detail": "Route",
    };
    document.title = activePanel ? `${panelTitles[activePanel]} — Logjam` : "Logjam";
  }, [activePanel]);

  // When switching away from canyon-detail via NavRail, clear selectedCanyonID
  const handlePanelChange = useCallback((panel: PanelId | null) => {
    if (panel !== "canyon-detail") {
      setSelectedCanyonID(null);
    }
    setActivePanel(panel);
  }, []);

  // When closing the panel
  const handlePanelClose = useCallback(() => {
    if (activePanel === "canyon-detail") {
      setSelectedCanyonID(null);
    }
    setActivePanel(null);
  }, [activePanel]);

  const auth = useAuth();
  const authenticated = auth.state === "authenticated";
  const { hydrateFromUser } = useThemePreferences();
  const { canyons, total: canyonsTotal, loaded: canyonsLoaded, error: canyonsError, refetch } = useCanyons(authenticated);
  const { canyons: sharedCanyons, error: sharedError, refetch: refetchShared } =
    useSharedCanyons(authenticated);
  // Also fetched for the Routes panel, which lists the same track files.
  const { tracks: canyonTracks, refetch: refetchCanyonTracks } = useCanyonTracks(
    authenticated && (showCanyonTracks || activePanel === "routes"),
  );
  // Routes load whenever the layer is on OR a draw/edit session is live (the
  // editor needs the row it is editing even with the layer toggled off).
  const { routes, refetch: refetchRoutes } = useRoutes(
    authenticated && (showRoutes || drawingRoute || activePanel === "routes"),
  );
  // A canyon list change (e.g. after a track upload) should refresh the layer.
  useEffect(() => {
    if (showCanyonTracks) refetchCanyonTracks();
  }, [canyons, sharedCanyons, showCanyonTracks, refetchCanyonTracks]);
  const {
    friends,
    requests: friendRequests,
    error: friendsError,
    refetch: refetchFriends,
  } = useFriends(authenticated);
  const {
    notifications,
    total: notificationsTotal,
    unreadCount,
    error: notificationsError,
    refetch: refetchNotifications,
  } = useNotifications(authenticated);
  const {
    tripLogs,
    total: tripLogsTotal,
    loading: tripLogsLoading,
    error: tripLogsError,
    refetch: refetchTripLogs,
  } = useTripLogs(authenticated);
  const { analytics, loading: analyticsLoading, error: analyticsError, refetch: refetchAnalytics } = useAnalytics(authenticated);
  const { currentUser, refetchCurrentUser, applyCurrentUser } = useCurrentUser(authenticated);
  const {
    vectorStyle,
    setVectorStyle: setLiveVectorStyle,
    saveError: vectorStyleSaveError,
  } = useLiveVectorStyle(authenticated);

  const [customFieldDefs, setCustomFieldDefs] = useState<
    TripLogCustomFieldDef[]
  >([]);

  // Refresh analytics whenever the analytics panel opens
  useEffect(() => {
    if (activePanel === "analytics" && authenticated) refetchAnalytics();
  }, [activePanel, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Surface background data-load errors as toasts
  useEffect(() => { if (canyonsError) toast.error(canyonsError); }, [canyonsError, toast]);
  useEffect(() => { if (sharedError) toast.error(sharedError); }, [sharedError, toast]);
  useEffect(() => { if (friendsError) toast.error(friendsError); }, [friendsError, toast]);
  useEffect(() => { if (notificationsError) toast.error(notificationsError); }, [notificationsError, toast]);
  useEffect(() => { if (tripLogsError) toast.error(tripLogsError); }, [tripLogsError, toast]);
  useEffect(() => { if (analyticsError) toast.error(analyticsError); }, [analyticsError, toast]);
  useEffect(() => { if (vectorStyleSaveError) toast.error(vectorStyleSaveError); }, [vectorStyleSaveError, toast]);

  useEffect(() => {
    if (!authenticated) return;
    // Best-effort: hydration prefetch for the map/sidebar; UI degrades
    // gracefully (panels show their own empty/error states) if this fails.
    hydrateFromUser().catch(console.error);
    fetchCurrentUser()
      .then((user) => {
        setCustomFieldDefs(user.uiPreferences?.tripLogCustomFields ?? []);
        setCanyonCustomFieldDefs(user.uiPreferences?.canyonCustomFields ?? []);
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
    if (!authenticated) return;
    apiFetch<TopoJob[]>("/topo-jobs")
      .then((jobs) => {
        const resumable = jobs.filter(
          (j) => j.status === "pending" || j.status === "processing",
        );
        if (resumable.length) setActiveTopoJobs(resumable);
      })
      // Best-effort: if this fails, in-progress jobs simply won't resume
      // polling until the next page load — non-critical background refresh.
      .catch((err) => { console.error(err); });
  }, [authenticated]);

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
      .catch((err) => { console.error(err); });
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    refetchCompletedTopoJobs();
  }, [authenticated, refetchCompletedTopoJobs]);

  // Pre-refetch presigned PMTiles URLs ~30 min before the server-reported expiry
  // so MapLibre tile requests never see a 403 in an active session.
  useEffect(() => {
    if (!authenticated || !overlaysExpiresAt) return;
    const refetchAt = new Date(overlaysExpiresAt).getTime() - 30 * 60 * 1000;
    const delay = refetchAt - Date.now();
    if (delay <= 0) {
      refetchCompletedTopoJobs();
      return;
    }
    const timer = setTimeout(() => { refetchCompletedTopoJobs(); }, delay);
    return () => clearTimeout(timer);
  }, [authenticated, overlaysExpiresAt, refetchCompletedTopoJobs]);

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
  } = useTopoExports(authenticated);

  // GeoPDF jobs are also polled here (in addition to the sidebar panel) so
  // auto-download works even when the Generated PDFs panel is closed. The hook
  // self-throttles: it only polls while a job is queued/running.
  const { jobs: geoPdfJobs, refetch: refetchGeoPdfJobs } = useGeoPdfJobs(authenticated);

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
    if (!authenticated) return;
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
  }, [authenticated, toast]);

  // Resolve a stashed ?export=<id> deep link: download the export directly
  // (mirrors NotificationsPanel.handleDownloadExport). A presign that has
  // expired (no downloadUrl) opens the LiDAR panel so the user can re-presign.
  useEffect(() => {
    if (!authenticated) return;
    const exportId = sessionStorage.getItem("pendingExportId");
    if (!exportId) return;
    sessionStorage.removeItem("pendingExportId");

    getTopoExport(exportId)
      .then((view) => {
        if (view.downloadUrl) {
          triggerDownload(view.downloadUrl);
        } else {
          setActivePanel("lidar");
          toast.error("Export download expired — re-open it from the LiDAR panel.");
        }
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load the export."));
      });
  }, [authenticated, toast]);

  // Resolve a stashed ?geoPdfJob=<id> deep link: open the GeoPDFs panel, whose
  // job list carries per-item download buttons (and auto-download for jobs this
  // tab queued). Refetch so a just-finished job shows immediately.
  useEffect(() => {
    if (!authenticated) return;
    const geoPdfJobId = sessionStorage.getItem("pendingGeoPdfJobId");
    if (!geoPdfJobId) return;
    sessionStorage.removeItem("pendingGeoPdfJobId");
    setActivePanel("geopdfs");
    setGeoPdfJobsRefetch((n) => n + 1);
  }, [authenticated]);

  // First login (empty account): offer a non-forced onboarding choice once,
  // after the first canyon fetch completes. The user picks RopeWiki, file
  // import, or starting empty — nothing auto-runs.
  useEffect(() => {
    if (canyonsLoaded && !importChecked.current) {
      importChecked.current = true;
      if (canyons.length === 0) {
        setShowOnboarding(true);
      }
    }
  }, [canyonsLoaded, canyons.length]);

  // Derived values
  const allCanyons = [...canyons, ...sharedCanyons];
  const filteredCanyons = useMemo(
    () => [
      ...canyons.filter((c) => passesFilters(c, filters, true)),
      ...sharedCanyons.filter((c) => passesFilters(c, filters, false)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canyons, sharedCanyons, filters],
  );
  const filtersActive = hasActiveFilters(filters);
  const clearFilters = () => setFilters(emptyFilters);
  const canyon = allCanyons.find((c) => c.id === selectedCanyonID);
  const ownedCanyonIds = new Set(canyons.map((c) => c.id));
  const isOwnedCanyon = canyon != null && ownedCanyonIds.has(canyon.id);

  const selectedAreaCanyons = selectedAreaCanyonIds
    .map((id) => allCanyons.find((c) => c.id === id))
    .filter((c): c is TCanyon => c != null);

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

  // Blocking re-consent gate (PRIV-002): a signed-in user whose recorded
  // consent version is stale or absent must re-consent before using the app
  // (the privacy.html / tos.html "re-consent on next sign-in" promise). The
  // pending-key fast path keeps the gate from flashing for fresh sign-ups
  // whose consent PATCH (recorded by the effect above) is still in flight.
  const pendingConsentMatchesCurrent =
    localStorage.getItem(PENDING_CONSENT_STORAGE_KEY) ===
    CURRENT_CONSENT_VERSION;
  const selectedRoute = routes.find((r) => r.id === selectedRouteID) ?? null;

  const startDrawingRoute = () => {
    setEditingRouteId(null);
    routeDraft.reset();
    setDrawingRoute(true);
    setActivePanel(null);
  };

  const startEditingRoute = (route: TRoute) => {
    setEditingRouteId(route.id);
    // Anchors come back with the route, so a snapped line reopens with the
    // user's own handful of points rather than every snapped vertex.
    routeDraft.reset({ points: route.points, anchors: route.anchors });
    setDrawingRoute(true);
    setActivePanel(null);
  };

  const cancelDrawingRoute = () => {
    setDrawingRoute(false);
    routeDraft.reset();
    setEditingRouteId(null);
  };

  const saveDrawnRoute = async (name: string) => {
    setSavingRoute(true);
    try {
      const payload = {
        name,
        points: routeDraft.points,
        anchors: routeDraft.anchorIndices,
      };
      const result = editingRouteId
        ? await updateRoute(editingRouteId, payload)
        : await createRoute(payload);
      setNamingRoute(false);
      cancelDrawingRoute();
      refetchRoutes();
      setSelectedRouteID(result.id);
      setActivePanel("route-detail");
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't save the route."));
    } finally {
      setSavingRoute(false);
    }
  };

  if (currentUser && needsReconsent(currentUser) && !pendingConsentMatchesCurrent) {
    return <ConsentGate onAccepted={applyCurrentUser} onSignOut={auth.signOut} />;
  }

  const dimUI = pickingCoords || selectingArea || selectingGeoPdfExtent;
  // Mobile: any map-selection flow needs the bottom sheet out of the way so the
  // map is tappable. Collapses the sheet to peek; restored when the flow ends.
  const mapInteractionActive =
    pickingCoords || selectingArea || selectingGeoPdfExtent || selectingTopoBbox;

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
        }}
        onSelectBbox={() => {
          setShowTopo(false);
          setSelectingTopoBbox(true);
        }}
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
        canyons={canyons}
        sharedCanyons={sharedCanyons}
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
          badgeCounts={{ notifications: unreadCount }}
        />
        <SidebarPanel
          activePanel={activePanel}
          onClose={handlePanelClose}
          onTopoFlyTarget={(footprint) => {
            setLidarEnabled(true);
            setTopoFlyTarget(footprint);
          }}
          showOwnedCanyons={showOwnedCanyons}
          setShowOwnedCanyons={setShowOwnedCanyons}
          showSharedCanyons={showSharedCanyons}
          setShowSharedCanyons={setShowSharedCanyons}
          showCanyonTracks={showCanyonTracks}
          setShowCanyonTracks={setShowCanyonTracks}
          showRoutes={showRoutes}
          setShowRoutes={setShowRoutes}
          onStartDrawingRoute={startDrawingRoute}
          selectedRoute={selectedRoute}
          allRoutes={routes}
          canyonTracks={canyonTracks}
          onSelectRoute={(id) => {
            setSelectedRouteID(id);
            setActivePanel("route-detail");
          }}
          onRouteHoverPosition={setRouteHoverPosition}
          currentUserId={currentUser?.id ?? null}
          onEditRoute={startEditingRoute}
          onRoutesChanged={refetchRoutes}
          lidarEnabled={lidarEnabled}
          setLidarEnabled={setLidarEnabled}
          lidarLayerToggles={lidarLayerToggles}
          setLidarLayerToggles={setLidarLayerToggles}
          lidarLayerOrder={lidarLayerOrder}
          setLidarLayerOrder={setLidarLayerOrder}
          unavailableTopoLayerNames={unavailableTopoLayerNames}
          baseLayers={BASE_LAYERS}
          activeLayerId={activeLayerId}
          onActiveLayerChange={setActiveLayerId}
          mapView={mapCenter}
          canyons={canyons}
          canyonsTotal={canyonsTotal}
          sharedCanyons={sharedCanyons}
          onAddCanyon={() => setShowAdd(true)}
          onOpenUnifiedImport={() => setShowUnifiedImport(true)}
          // Reuses the area-selection state, which is what SelectedCanyonsDialog
          // (the existing export surface) already renders from.
          onExportCanyons={setSelectedAreaCanyonIds}
          onStartAreaSelection={startAreaSelection}
          selectingArea={selectingArea}
          onCancelAreaSelection={cancelAreaSelection}
          onRefetch={refetch}
          filters={filters}
          onChangeFilters={setFilters}
          filtersAccordionSignal={filtersAccordionSignal}
          onFlyToCanyon={(lat, lng) => setFlyToCanyon({ lat, lng })}
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
          topoExports={topoExports}
          topoExportsTotal={topoExportsTotal}
          onRefetchTopoExports={refetchTopoExports}
          lidarJobToggles={lidarJobToggles}
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
          notificationsTotal={notificationsTotal}
          onRefetchNotifications={refetchNotifications}
          setSelectedCanyonID={setSelectedCanyonID}
          setActivePanel={setActivePanel}
          canyon={canyon}
          isOwnedCanyon={isOwnedCanyon}
          onPickCoords={startPickingCoords}
          pickingCoords={pickingCoords}
          onCancelPickCoords={cancelPickingCoords}
          tripLogs={tripLogs}
          tripLogsTotal={tripLogsTotal}
          tripLogsLoading={tripLogsLoading}
          onRefetchTripLogs={refetchTripLogs}
          onRefetchAnalytics={refetchAnalytics}
          customFieldDefs={customFieldDefs}
          onCustomFieldDefsChange={setCustomFieldDefs}
          canyonCustomFieldDefs={canyonCustomFieldDefs}
          onCanyonCustomFieldDefsChange={setCanyonCustomFieldDefs}
          analytics={analytics}
          analyticsLoading={analyticsLoading}
          vectorStyle={vectorStyle}
          onVectorStyleChange={setLiveVectorStyle}
          collapseToPeek={mapInteractionActive}
        />
      </div>
      <main id="main-content" className={classes.main}>
      <h1 className={classes.visuallyHidden}>Logjam canyon map</h1>
      <Map
        filters={filters}
        canyons={canyons}
        sharedCanyons={sharedCanyons}
        showOwnedCanyons={showOwnedCanyons}
        showSharedCanyons={showSharedCanyons}
        showCanyonTracks={showCanyonTracks}
        canyonTracks={canyonTracks}
        showRoutes={showRoutes}
        routes={routes}
        routeHoverPosition={routeHoverPosition}
        selectRoute={(id) => {
          setSelectedRouteID(id);
          setActivePanel("route-detail");
        }}
        drawingRoute={drawingRoute}
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
        selectCanyon={(id) => {
          setSelectedCanyonID(id);
          setActivePanel("canyon-detail");
        }}
        pickingCoords={pickingCoords}
        onCoordsPicked={handleCoordsPicked}
        onCancelPickCoords={cancelPickingCoords}
        selectingArea={selectingArea}
        onAreaSelected={handleAreaSelected}
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
        flyToCanyon={flyToCanyon}
        onFlyToCanyonConsumed={() => setFlyToCanyon(null)}
        sidebarOpen={activePanel !== null}
        onTopoSourceUnavailable={handleTopoSourceUnavailable}
      />
      </main>

      {drawingRoute && (
        <RouteDrawPanel
          points={routeDraft.points}
          anchorCount={routeDraft.draft.anchors.length}
          canUndo={routeDraft.canUndo}
          atCap={routeDraft.atCap}
          editingName={routes.find((r) => r.id === editingRouteId)?.name ?? null}
          onUndo={routeDraft.undo}
          onClear={() => routeDraft.reset()}
          onSave={() => setNamingRoute(true)}
          onCancel={cancelDrawingRoute}
          saving={savingRoute}
          snapMode={snapMode}
          onSnapModeChange={setSnapMode}
        />
      )}

      <RouteNameDialog
        open={namingRoute}
        initialName={
          routes.find((r) => r.id === editingRouteId)?.name ?? "New route"
        }
        busy={savingRoute}
        onSave={(name) => void saveDrawnRoute(name)}
        onClose={() => setNamingRoute(false)}
      />

      {selectingArea && (
        <div className={classes.selectAllButtons}>
          <Button variant="outlined" size="small" onClick={cancelAreaSelection}>
            Cancel
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => handleAreaSelected(allCanyons.map((c) => c.id))}
          >
            Select All
          </Button>
          {/* Only render when filters are active. When they aren't, "filtered"
              == all canyons (the button is redundant), and MUI's default
              disabled styling (grey-on-grey) is illegible floating over the
              map. Hiding it declutters the bar and drops it to two buttons that
              fit on one row on narrow phones. */}
          {filtersActive && (
            <Button
              variant="contained"
              size="small"
              onClick={() =>
                handleAreaSelected(filteredCanyons.map((c) => c.id))
              }
            >
              Select All Filtered
            </Button>
          )}
        </div>
      )}

      {filtersActive && !dimUI && (
        <FilterStatusChip
          filteredCount={filteredCanyons.length}
          totalCount={allCanyons.length}
          onOpenFilters={() => {
            setActivePanel("canyons");
            setFiltersAccordionSignal((n) => n + 1);
          }}
          onClearFilters={clearFilters}
        />
      )}
      {filtersActive && canyonsLoaded && !dimUI && filteredCanyons.length === 0 && (
        <FilterEmptyState onClearFilters={clearFilters} />
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

      {/* Unified file importer (canyons + logbooks) */}
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
        canyons={canyons}
        customFieldDefs={customFieldDefs}
        onCustomFieldDefsChange={setCustomFieldDefs}
        currentUser={currentUser}
        onRefetchCanyons={refetch}
        onRefetchTripLogs={refetchTripLogs}
        onRefetchAnalytics={refetchAnalytics}
        onPickCoords={startPickingCoords}
      />

      {/* Add canyon dialog */}
      <CanyonDialog
        canyon={null}
        open={showAdd && !pickingCoords}
        onClose={() => setShowAdd(false)}
        onSaved={refetch}
        onPickCoords={startPickingCoords}
        onCancelPickCoords={cancelPickingCoords}
        customFieldDefs={canyonCustomFieldDefs}
        onCustomFieldDefsChange={setCanyonCustomFieldDefs}
      />

      <SelectedCanyonsDialog
        open={selectedAreaCanyonIds.length > 0}
        selectedCanyons={selectedAreaCanyons}
        availableCanyons={allCanyons}
        ownedCanyonIds={ownedCanyonIds}
        friends={friends}
        onClose={() => setSelectedAreaCanyonIds([])}
        onDeleted={refetch}
        onQuotaChanged={refetchCurrentUser}
        onRemoveCanyon={(id) => setSelectedAreaCanyonIds((ids) => ids.filter((x) => x !== id))}
        onAddCanyon={(id) =>
          setSelectedAreaCanyonIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
        }
      />
    </div>
  );
}

export default App;
