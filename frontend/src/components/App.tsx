import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import NavRail from "./sidebar/NavRail";
import SidebarPanel from "./sidebar/SidebarPanel";
import Map, { BASE_LAYERS } from "./map/Map";
import SignIn from "./SignIn";
import ImportDialog from "./dialogs/ImportDialog";
import TopoDialog from "./dialogs/TopoDialog";
import type {
  TopoJob,
  DownloadUrl,
  GeoJsonPolygon,
} from "./dialogs/TopoDialog";
import GeoPdfDialog from "./dialogs/GeoPdfDialog";
import GeoPdfTemplatesDialog from "./dialogs/GeoPdfTemplatesDialog";
import type { GeoPdfTemplate } from "./dialogs/GeoPdfTemplatesDialog";
import CanyonDialog from "./dialogs/CanyonDialog";
import CanyonCsvImportDialog from "./dialogs/CanyonCsvImportDialog";
import SelectedCanyonsDialog from "./dialogs/SelectedCanyonsDialog";
import classes from "./App.module.css";
import type { TBbox } from "./map/Map";
import type { TFilters, TCanyon } from "../canyonUtils";
import type { PanelId } from "./sidebar/panels";
import { TOPO_LAYERS } from "../topoLayerTypes";
import type { CompletedTopoJob } from "../topoLayerTypes";
import {
  useCanyons,
  useSharedCanyons,
  useFriends,
  useNotifications,
  useTripLogs,
  useAnalytics,
  fetchCurrentUser,
  passesFilters,
  syncOzUltimateSources,
  apiFetch,
} from "../canyonUtils";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import { useAuth } from "../useAuth";
import { Button } from "@mui/material";
import { useThemePreferences } from "../themePreferences";

function App() {
  const [filters, setFilters] = useState<TFilters>({
    name: null,
    v_grade: null,
    a_grade: null,
    commitment: null,
    quality: null,
    pitches: null,
    longest_pitch: null,
    hours: null,
    wetsuits: null,
  });
  const [selectedCanyonID, setSelectedCanyonID] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [activeLayerId, setActiveLayerId] = useState(BASE_LAYERS[0].id);

  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
const [showCanyonCsvImport, setShowCanyonCsvImport] = useState(false);
  const importChecked = useRef(false);
  const pendingOzSync = useRef(false);

  // Layer visibility toggles
  const [showOwnedCanyons, setShowOwnedCanyons] = useState(true);
  const [showSharedCanyons, setShowSharedCanyons] = useState(true);

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
  const [topoDownloadUrls, setTopoDownloadUrls] = useState<
    Record<string, DownloadUrl[]>
  >({});
  const [topoFlyTarget, setTopoFlyTarget] = useState<GeoJsonPolygon | null>(
    null,
  );
  // All of the user's completed topo jobs (with presigned PMTiles URLs per
  // layer). Replaces the old single "master" mosaic — each job is its own
  // set of overlays, controlled per-job in the Overlays panel.
  const [completedTopoJobs, setCompletedTopoJobs] = useState<
    CompletedTopoJob[]
  >([]);

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

  // Map view state for GeoPDF extent initialization
  const [mapCenter, setMapCenter] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // GeoPDF Templates dialog
  const [showGeoPdfTemplates, setShowGeoPdfTemplates] = useState(false);
  const [editingGeoPdfTemplate, setEditingGeoPdfTemplate] = useState<
    GeoPdfTemplate | null | undefined
  >(undefined);

  // LiDAR topo panel state — lifted so it persists across panel open/close
  const [lidarEnabled, setLidarEnabled] = useState(false);
  const [lidarLayerToggles, setLidarLayerToggles] = useState<
    Record<string, boolean>
  >(() => Object.fromEntries(TOPO_LAYERS.map((l) => [l.name, true])));
  const [lidarLayerOrder, setLidarLayerOrder] = useState<string[]>(
    TOPO_LAYERS.map((l) => l.name),
  );
  // Per-completed-job visibility. Newly fetched jobs default to true (visible).
  const [lidarJobToggles, setLidarJobToggles] = useState<
    Record<string, boolean>
  >({});

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
    }[] = [];
    for (const layerName of lidarLayerOrder) {
      if (!lidarLayerToggles[layerName]) continue;
      for (const job of completedTopoJobs) {
        if (!(lidarJobToggles[job.jobId] ?? true)) continue;
        const match = job.layers.find((l) => l.name === layerName);
        if (!match) continue;
        out.push({
          id: `${job.jobId}-${layerName}`,
          pmtilesUrl: match.pmtilesUrl,
          format: match.format,
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
  const { canyons, loaded: canyonsLoaded, refetch } = useCanyons(authenticated);
  const { canyons: sharedCanyons, refetch: refetchShared } =
    useSharedCanyons(authenticated);
  const {
    friends,
    requests: friendRequests,
    refetch: refetchFriends,
  } = useFriends(authenticated);
  const {
    notifications,
    unreadCount,
    refetch: refetchNotifications,
  } = useNotifications(authenticated);
  const {
    tripLogs,
    loading: tripLogsLoading,
    refetch: refetchTripLogs,
  } = useTripLogs(authenticated);
  const { analytics, loading: analyticsLoading } = useAnalytics(authenticated);

  const [customFieldDefs, setCustomFieldDefs] = useState<
    TripLogCustomFieldDef[]
  >([]);

  useEffect(() => {
    if (!authenticated) return;
    hydrateFromUser().catch(console.error);
    // Fetch user preferences to get custom field definitions
    fetchCurrentUser()
      .then((user) => {
        setCustomFieldDefs(user.uiPreferences?.tripLogCustomFields ?? []);
      })
      .catch(console.error);
  }, [authenticated, hydrateFromUser]);

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
      .catch(() => {});
  }, [authenticated]);

  // Fetch the user's completed topo jobs (with presigned PMTiles URLs) on
  // auth and whenever a job transitions to complete.
  const refetchCompletedTopoJobs = useCallback(() => {
    return apiFetch<CompletedTopoJob[]>("/topo-jobs/completed-overlays")
      .then((jobs) => {
        setCompletedTopoJobs(jobs);
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
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    refetchCompletedTopoJobs();
  }, [authenticated, refetchCompletedTopoJobs]);

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
            const urls = await apiFetch<DownloadUrl[]>(
              `/topo-jobs/${updated.id}/download-urls`,
            );
            setTopoDownloadUrls((prev) => ({ ...prev, [updated.id]: urls }));
            setActiveTopoJobs((prev) =>
              prev.filter((j) => j.id !== updated.id),
            );
            refetchNotifications();
            refetchCompletedTopoJobs();
          }
        } catch {
          // silent — will retry next tick
        }
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [activeTopoJobs, refetchNotifications, refetchCompletedTopoJobs]);

  const handleTopoJobCreated = useCallback((job: TopoJob) => {
    setActiveTopoJobs((prev) => [job, ...prev]);
  }, []);

  // Show import dialog once when user has no canyons after first fetch completes
  useEffect(() => {
    if (canyonsLoaded && !importChecked.current) {
      importChecked.current = true;
      if (canyons.length === 0) {
        setShowImport(true);
      }
    }
  }, [canyonsLoaded, canyons.length]);

  // After a Ropewiki import/refresh, sync OzUltimate source links onto matching canyons
  useEffect(() => {
    if (!pendingOzSync.current || !canyonsLoaded || canyons.length === 0)
      return;
    pendingOzSync.current = false;
    syncOzUltimateSources(canyons).then((updated) => {
      if (updated) refetch();
    });
  }, [canyons, canyonsLoaded, refetch]);

  // Derived values
  const allCanyons = [...canyons, ...sharedCanyons];
  const canyon = allCanyons.find((c) => c.id === selectedCanyonID);
  const ownedCanyonIds = new Set(canyons.map((c) => c.id));
  const isOwnedCanyon = canyon != null && ownedCanyonIds.has(canyon.id);

  const selectedAreaCanyons = selectedAreaCanyonIds
    .map((id) => allCanyons.find((c) => c.id === id))
    .filter((c): c is TCanyon => c != null);

  // While checking for an existing session, render nothing to avoid
  // a brief flash of the sign-in form before the session loads.
  if (auth.state === "loading") return null;

  if (!authenticated) {
    return (
      <SignIn
        authState={auth.state}
        error={auth.error}
        onSignIn={auth.signIn}
        onSignUp={auth.signUp}
        onConfirmSignUp={auth.confirmSignUp}
        goToSignUp={auth.goToSignUp}
        goToSignIn={auth.goToSignIn}
      />
    );
  }

  const dimUI = pickingCoords || selectingArea || selectingGeoPdfExtent;

  return (
    <div className={classes.app}>
      <ImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={() => {
          pendingOzSync.current = true;
          refetch();
        }}
      />
      <TopoDialog
        open={showTopo}
        onClose={() => {
          setShowTopo(false);
          setSelectingTopoBbox(false);
        }}
        onSelectBbox={() => {
          setShowTopo(false);
          setSelectingTopoBbox(true);
        }}
        pendingBbox={pendingTopoBbox}
        jobs={activeTopoJobs}
        downloadUrlsMap={topoDownloadUrls}
        onJobCreated={handleTopoJobCreated}
      />
      <GeoPdfDialog
        open={showGeoPdf}
        onClose={() => {
          setShowGeoPdf(false);
          setEditingGeoPdfTemplate(undefined);
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
          setShowGeoPdfTemplates(true);
        }}
      />
      <GeoPdfTemplatesDialog
        open={showGeoPdfTemplates}
        onClose={() => setShowGeoPdfTemplates(false)}
        onEditTemplate={(template) => {
          setEditingGeoPdfTemplate(template);
          setShowGeoPdfTemplates(false);
          setShowGeoPdf(true);
        }}
      />
      <div className={dimUI ? classes.dimmed : undefined}>
        <NavRail
          activePanel={activePanel}
          onPanelChange={handlePanelChange}
          unreadCount={unreadCount}
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
          baseLayers={BASE_LAYERS}
          activeLayerId={activeLayerId}
          onActiveLayerChange={setActiveLayerId}
          onAddCanyon={() => setShowAdd(true)}
          onOpenCanyonCsvImport={() => setShowCanyonCsvImport(true)}
          onOpenTopo={() => setShowTopo(true)}
          onOpenGeoPdf={() => setShowGeoPdf(true)}
          onOpenGeoPdfTemplates={() => setShowGeoPdfTemplates(true)}
          onStartAreaSelection={startAreaSelection}
          selectingArea={selectingArea}
          onCancelAreaSelection={cancelAreaSelection}
          onRefetch={() => {
            pendingOzSync.current = true;
            refetch();
          }}
          filters={filters}
          onChangeFilters={setFilters}
          friends={friends}
          friendRequests={friendRequests}
          onRefetchFriends={refetchFriends}
          onRefetchShared={refetchShared}
          notifications={notifications}
          onRefetchNotifications={refetchNotifications}
          setSelectedCanyonID={setSelectedCanyonID}
          setActivePanel={setActivePanel}
          canyon={canyon}
          isOwnedCanyon={isOwnedCanyon}
          onPickCoords={startPickingCoords}
          pickingCoords={pickingCoords}
          onCancelPickCoords={cancelPickingCoords}
          tripLogs={tripLogs}
          tripLogsLoading={tripLogsLoading}
          onRefetchTripLogs={refetchTripLogs}
          customFieldDefs={customFieldDefs}
          onCustomFieldDefsChange={setCustomFieldDefs}
          canyons={canyons}
          analytics={analytics}
          analyticsLoading={analyticsLoading}
          lidarEnabled={lidarEnabled}
          setLidarEnabled={setLidarEnabled}
          lidarLayerToggles={lidarLayerToggles}
          setLidarLayerToggles={setLidarLayerToggles}
          lidarLayerOrder={lidarLayerOrder}
          setLidarLayerOrder={setLidarLayerOrder}
          completedTopoJobs={completedTopoJobs}
          lidarJobToggles={lidarJobToggles}
          setLidarJobToggles={setLidarJobToggles}
        />
      </div>
      <Map
        filters={filters}
        canyons={canyons}
        sharedCanyons={sharedCanyons}
        showOwnedCanyons={showOwnedCanyons}
        showSharedCanyons={showSharedCanyons}
        selectCanyon={(id) => {
          setSelectedCanyonID(id);
          setActivePanel("canyon-detail");
        }}
        pickingCoords={pickingCoords}
        onCoordsPicked={handleCoordsPicked}
        selectingArea={selectingArea}
        onAreaSelected={handleAreaSelected}
        selectingBbox={selectingTopoBbox}
        onBboxSelected={(bbox) => {
          setPendingTopoBbox(bbox);
          setSelectingTopoBbox(false);
          setShowTopo(true);
        }}
        topoLayers={combinedTopoLayers}
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
        onMapViewChange={(center) => setMapCenter(center)}
        topoFlyTarget={topoFlyTarget}
        onTopoFlyConsumed={() => setTopoFlyTarget(null)}
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
          <Button
            variant="contained"
            size="small"
            disabled={!Object.values(filters).some((v) => v !== null)}
            onClick={() =>
              handleAreaSelected(
                allCanyons
                  .filter((c) => passesFilters(c, filters))
                  .map((c) => c.id),
              )
            }
          >
            Select All Filtered
          </Button>
        </div>
      )}

      {/* Canyon CSV import dialog */}
      <CanyonCsvImportDialog
        open={showCanyonCsvImport}
        onClose={() => setShowCanyonCsvImport(false)}
        canyons={canyons}
        onRefetchCanyons={refetch}
      />

      {/* Add canyon dialog */}
      <CanyonDialog
        canyon={null}
        open={showAdd && !pickingCoords}
        onClose={() => setShowAdd(false)}
        onSaved={refetch}
        onPickCoords={startPickingCoords}
        onCancelPickCoords={cancelPickingCoords}
      />

      <SelectedCanyonsDialog
        open={selectedAreaCanyonIds.length > 0}
        selectedCanyons={selectedAreaCanyons}
        ownedCanyonIds={ownedCanyonIds}
        friends={friends}
        onClose={() => setSelectedAreaCanyonIds([])}
        onDeleted={refetch}
      />
    </div>
  );
}

export default App;
