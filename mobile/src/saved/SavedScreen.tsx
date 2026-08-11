// Saved tab — on-device map asset MANAGEMENT: downloaded regions/LiDAR topo
// overlays, GeoPDF + vector-file imports, recorded tracks. Split out of the
// Map screen's "Map layers" sheet (which keeps only viewport-bound actions and
// per-asset visibility toggles) — see MapScreen.tsx's header comment for the
// full display/management split.
//
// LAYOUT (the reference implementation of mobile/DESIGN.md):
//   HeroHeader — storage headline + a CapacityBar breaking it down by asset
//     kind. One "Add" affordance opens the acquisition sheet, so the screen
//     body is purely what is already here.
//   Filter rail — categories with tallies; "All" is a flat size-descending
//     list of everything on device, which is what "reclaim space" wants.
//   Rows — one Row per asset with its kind's hue + glyph, and an overflow
//     sheet carrying the three things you can do to any asset: show it on the
//     map, rename it, delete it.
// Not-yet-downloaded topo overlays are the one non-on-device list: they live
// under the LiDAR Topos filter below the saved ones, never in "All".
//
// This screen mounts the same registry/hooks MapScreen does
// (useMapArtifacts, useGeoPdfImports, useVectorImports, useTracks); each
// mutation here notifies through the shared listeners those hooks subscribe
// to, so a Map screen kept mounted in the background stays in sync (the one
// exception — topo-overlay "enabled" visibility — is a plain persisted flag
// with no change listener; MapScreen re-reads it on focus to cover the gap,
// see the comment on its `enabledOverlays` effect).
//
// PRIVACY: nothing here renders coordinates or bboxes — rows show generic
// labels ("Offline map region"), user-supplied names (renames, GeoPDF/track
// titles, topo job names), and sizes/dates only. "Show on map" passes a bbox
// through navigation params to MapScreen's camera; in memory only, never
// logged, never persisted.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View, type TextInput } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useFocusEffect } from "@react-navigation/native";
import * as FileSystem from "expo-file-system";

import {
  formatDistanceM,
  routeLengthM,
  messageFromError,
  type TopoLayerFormat,
  type TopoLayerName,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { formatBytes } from "../format";
import { getGeoPdfJob, listGeoPdfJobs, type GeoPdfJobView } from "../api/geoPdfJobs";
import { useApiQuery } from "../api/queries";
import { useMirrorRoutes, usePendingSyncCount } from "../sync/useSyncQueries";
import { assetHue, fontSize, fontWeight, spacing, theme } from "../theme";
import {
  BottomSheet,
  Button,
  CapacityBar,
  HeroHeader,
  IconButton,
  Row,
  SectionHeader,
  SegmentedControl,
  StatusPill,
  SyncStatusPills,
  TextField,
  Toast,
  type CapacitySegment,
  type SegmentOption,
  type ToastMessage,
} from "../ui";
import {
  GEOPDF_ERRORS,
  importGeoPdfFromPicker,
  importGeoPdfFromUrl,
  resumeGeoPdfImport,
} from "../geopdf/importPipeline";
import {
  CANCELLABLE_PHASES,
  GEOPDF_PHASE_LABEL,
  cancelGeoPdfImportRun,
  runGeoPdfImport,
  useGeoPdfImportRun,
} from "../geopdf/importRunner";
import { useGeoPdfImports } from "../geopdf/useGeoPdfImports";
import { importVectorFileFromPicker } from "../imports/vectorImports";
import { useVectorImports } from "../imports/useVectorImports";
import { useAccountState } from "../auth/AccountStateContext";
import { capabilityRowProps, capabilityStatus } from "../auth/capabilities";
import { useConnectivity } from "../map/connectivity";
import type { BasemapId } from "../map/sourceResolver";
import { mergeSavedOverlayJobs, type CompletedOverlaysResponse } from "../map/topoOverlays";
import { downloadTopoOverlay } from "../offline/overlayDownloads";
import { deleteDownloadedArtifact } from "../offline/regionDownloads";
import { renameArtifact } from "../offline/registryDb";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import {
  geoPdfActions,
  trackActions,
  routeActions,
  vectorImportActions,
} from "./assetActions";
import { useTracks } from "../tracks/useTracks";
import { ExportUnsupportedError, type ExportFormat } from "../fileExport";
import type { Bbox } from "./bboxOfPoints";
import type { MirrorRoute } from "../sync/mirrorStore";
import { RouteOptionsSheet } from "../routes/RouteOptionsSheet";
import { RouteStatsSheet } from "../routes/RouteStatsSheet";
import { LinkCanyonSheet } from "../routes/LinkCanyonSheet";

function getCompletedOverlays(): Promise<CompletedOverlaysResponse> {
  return apiFetch<CompletedOverlaysResponse>("/topo-jobs/completed-overlays");
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// --- Category model -------------------------------------------------------
// One entry per asset kind: the filter rail, the capacity meter and every
// row's glyph/hue all read from here, so a new asset kind is one addition.
type Category = "region" | "overlay" | "geoPdf" | "route" | "vector" | "track";

const CATEGORY_META: Record<
  Category,
  {
    label: string;
    plural: string;
    icon: "map" | "layers" | "file-text" | "file-plus" | "activity" | "edit-3";
  }
> = {
  region: { label: "Region", plural: "Regions", icon: "map" },
  overlay: { label: "LiDAR topo", plural: "LiDAR Topos", icon: "layers" },
  geoPdf: { label: "GeoPDF", plural: "GeoPDFs", icon: "file-text" },
  // "Files" was too vague (everything here is a file); the category is
  // specifically vector data brought in from another app, so it is named for
  // the formats users recognise.
  // Routes you drew, as opposed to files you brought in. Kept a separate
  // category rather than folded into "vector": they behave differently (a route
  // is editable and syncs; an import is an opaque file on this device), and a
  // list that mixes them would need to explain which rows can be edited.
  route: { label: "Route", plural: "Routes", icon: "edit-3" },
  vector: { label: "GPX / KML", plural: "GPX & KML", icon: "file-plus" },
  track: { label: "Track", plural: "Tracks", icon: "activity" },
};

const CATEGORY_ORDER: Category[] = [
  "region",
  "overlay",
  "geoPdf",
  "route",
  "vector",
  "track",
];

/** A single on-device asset, flattened so one renderer covers every kind. */
type SavedItem = {
  key: string;
  category: Category;
  title: string;
  subtitle: string;
  sizeBytes: number;
  pill?: { label: string; tone: "accent" | "outline" | "warning" | "muted" };
  /** Recovery/primary inline action shown left of the overflow button. */
  inlineAction?: { icon: "refresh-cw"; label: string; onPress: () => void };
  /** False when the asset has no geographic extent to fly to. */
  locatable: boolean;
  /**
   * Basemap to switch the map to when showing this asset. Set on a downloaded
   * REGION: a region is tiles for one basemap, and flying to it while a
   * different basemap is selected — the common case offline, since the map
   * keeps whatever the user last chose — lands them on a blank rectangle that
   * looks like the download failed.
   */
  focusBasemapId?: BasemapId;
  /** Resolved on tap — a track's extent needs its points read back. */
  resolveBbox: () => Promise<Bbox | null>;
  /** Persist a new display name. Every kind supports this. */
  rename: (name: string) => Promise<unknown>;
  delete: { confirmTitle: string; confirmBody: string; run: () => Promise<unknown> };
  /** Present on an editable route — the map's draw tool reopens this id. */
  editableRouteId?: string;
  /** Present on an editable route: flip vertex order (direction is semantic). */
  reverse?: () => Promise<unknown>;
  /** Present on a recording: make an editable route from it, non-destructively. */
  createRouteFrom?: () => Promise<{ name: string; pointCount: number }>;
  /** Present on a recording: save it out as a GPX or KML file. */
  exportFile?: (format: ExportFormat) => Promise<string | null>;
};

export function SavedScreen({
  onOpenMap,
  onDownloadRegion,
  onEditRoute,
  initialFilter,
}: {
  onOpenMap: (bbox?: Bbox, basemapId?: BasemapId) => void;
  onDownloadRegion: () => void;
  /** Open the map's draw tool on an existing route. Editing is a map gesture,
   *  so this screen hands it over rather than growing an editor of its own. */
  onEditRoute: (routeId: string) => void;
  /**
   * Land on one category rather than "All". The map's layer sheet points at
   * this screen for region management ("3 saved areas ›"), and dropping the
   * user in an everything-list to find them again is a dead-ended handoff.
   *
   * `nonce` makes a REPEAT request work: navigating a second time with the same
   * category leaves the params identical, so nothing downstream changes and the
   * user stays on whatever filter they picked in between.
   */
  initialFilter?: { category: Category; nonce: number };
}) {
  const connectivity = useConnectivity();
  const online = connectivity === "online";
  // Both of these come off the user's web account, so a guest has neither.
  // Local imports (a GeoPDF or a GPX off this phone's storage) are unaffected
  // and stay in the same sheet — the point being that "Add to this device"
  // still does something useful without an account.
  const { accountState } = useAccountState();
  const lidarReady =
    capabilityStatus("lidarOverlays", accountState, online).status === "available";
  const accountGeoPdfReady =
    capabilityStatus("accountGeoPdf", accountState, online).status === "available";
  const pendingCount = usePendingSyncCount();

  // One toast channel for every async outcome on the screen (import, save,
  // rename, account list). Transient and out of the layout — a banner in the
  // list reflows content under the user's thumb and then lingers unowned.
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastNonce = useRef(0);
  const info = useCallback((text: string) => {
    toastNonce.current += 1;
    setToast({ text, tone: "info", nonce: toastNonce.current });
  }, []);
  const fail = useCallback((text: string) => {
    toastNonce.current += 1;
    setToast({ text, tone: "error", nonce: toastNonce.current });
  }, []);

  // Free device space is a point-in-time read; refresh whenever this tab
  // regains focus (a delete/save on this same screen updates it directly).
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const refreshFreeSpace = useCallback(() => {
    FileSystem.getFreeDiskStorageAsync().then(setFreeBytes).catch(console.error);
  }, []);
  const [filter, setFilter] = useState<Category | "all">(
    initialFilter?.category ?? "all",
  );
  // A later arrival re-selects, even for the same category — this tab stays
  // mounted, so the pointer has to work every time it is followed.
  useEffect(() => {
    if (initialFilter) setFilter(initialFilter.category);
  }, [initialFilter?.nonce, initialFilter]);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  // The per-item sheet has two faces: its action list, and the rename form the
  // "Rename" action swaps in. ONE sheet, not two — a second Modal opening while
  // the first closes never gets window focus, so the field's keyboard silently
  // fails to rise, and the user sees the sheet settle then jump.
  const [menuItemKey, setMenuItemKey] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState<"actions" | "rename">("actions");
  const closeItemSheet = useCallback(() => {
    setMenuItemKey(null);
    setMenuMode("actions");
  }, []);
  const openItemSheet = useCallback((key: string) => {
    setMenuMode("actions");
    setMenuItemKey(key);
  }, []);

  // Leaving the tab drops any open per-item sheet: coming back to a rename form
  // for a row you have since navigated away from is a stale prompt, not a
  // resumed task.
  useFocusEffect(
    useCallback(() => {
      refreshFreeSpace();
      return closeItemSheet;
    }, [closeItemSheet, refreshFreeSpace]),
  );

  // Changing category is changing subject — abandon an in-progress rename with
  // it rather than leaving a form floating over a list it no longer belongs to.
  const selectFilter = useCallback(
    (next: Category | "all") => {
      closeItemSheet();
      setFilter(next);
    },
    [closeItemSheet],
  );

  // Single in-flight operation banner: the pipelines here are exclusive (one
  // import / one overlay download at a time), so one row above the list
  // carries label and progress for whichever is running.
  //
  // GeoPDF imports are NOT one of them any more — they take the whole screen
  // (see geoPdfOp below), because their opening phases block the JS thread and
  // a progress row on a frozen list is a worse lie than no row.
  const [activeOp, setActiveOp] = useState<{
    label: string;
    category: Category;
    fraction: number | null;
  } | null>(null);

  // --- Downloaded regions + topo overlays (registry-backed) ---
  const { artifacts } = useMapArtifacts();
  const regionArtifacts = artifacts.filter((a) => a.kind === "basemap-region");

  const overlaysQuery = useApiQuery(
    getCompletedOverlays,
    "Couldn't load topo overlays.",
    accountState !== "guest",
  );
  const mergedOverlays = mergeSavedOverlayJobs(overlaysQuery.data, artifacts);
  const overlayCatalog = mergedOverlays.jobs.flatMap((job) =>
    job.layers.map((layer) => ({
      key: `${job.jobId}/${layer.name}`,
      label: `${job.name ?? job.jobId.slice(0, 8)} — ${layer.name}`,
      jobId: job.jobId,
      layer: layer.name,
      format: layer.format,
      pmtilesUrl: layer.pmtilesUrl,
    })),
  );

  // Wi-Fi-only download default (stage4a §5.6 policy) — same confirm as the
  // map's "download current area", recreated here since overlay saves are
  // viewport-independent asset management, not a map-viewport action.
  const confirmCellularOk = useCallback(async (): Promise<boolean> => {
    const netState = await NetInfo.fetch();
    if (netState.type !== "cellular") return true;
    return new Promise((resolve) => {
      Alert.alert(
        "Use mobile data?",
        "You're not on Wi-Fi. Download over mobile data?",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Download", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }, []);

  const [overlayBusyKey, setOverlayBusyKey] = useState<string | null>(null);
  const handleSaveOverlay = useCallback(
    async (item: {
      key: string;
      label: string;
      jobId: string;
      layer: TopoLayerName;
      format: TopoLayerFormat;
      pmtilesUrl: string;
    }) => {
      try {
        if (!(await confirmCellularOk())) return;
        setOverlayBusyKey(item.key);
        setActiveOp({
          label: `Saving ${item.label}`,
          category: "overlay",
          fraction: null,
        });
        await downloadTopoOverlay(
          {
            jobId: item.jobId,
            layer: item.layer,
            format: item.format,
            pmtilesUrl: item.pmtilesUrl,
          },
          (p) =>
            setActiveOp((current) =>
              current
                ? { ...current, fraction: p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : null }
                : current,
            ),
        );
        info("Overlay saved for offline use.");
        refreshFreeSpace();
      } catch (err) {
        console.error(err);
        fail(messageFromError(err, "Couldn't save this overlay."));
      } finally {
        setOverlayBusyKey(null);
        setActiveOp(null);
      }
    },
    [confirmCellularOk, fail, info, refreshFreeSpace],
  );

  // --- Drawn routes (synced records, not device files) ---
  const routes = useMirrorRoutes();

  // --- Vector imports (GPX/KML/GeoJSON) ---
  const { imports } = useVectorImports();
  const [importBusy, setImportBusy] = useState(false);
  const handleImportFile = useCallback(async () => {
    try {
      setImportBusy(true);
      setActiveOp({
        label: "Importing file",
        category: "vector",
        fraction: null,
      });
      const outcome = await importVectorFileFromPicker(imports.length);
      if (outcome.status === "imported") {
        info("File imported.");
        // Land on the tab holding what was just added, so the new row is
        // visible instead of buried in a size-sorted "All".
        setFilter("vector");
        refreshFreeSpace();
      }
    } catch (err) {
      console.error(err);
      fail(messageFromError(err, "Couldn't import that file."));
    } finally {
      setImportBusy(false);
      setActiveOp(null);
    }
  }, [fail, imports.length, info, refreshFreeSpace]);

  // --- GeoPDF imports ---
  const { geoPdfImports } = useGeoPdfImports();

  // A GeoPDF import runs in the BACKGROUND (geopdf/importRunner.ts): this
  // screen starts it and shows a progress card, but does not own it. The user
  // can leave, use the map, and get a toast when it lands. What this screen
  // owns is the card and the "one at a time" affordance — `geoPdfBusy` greys
  // the import buttons out while a run is up, wherever it was started from.
  const importRun = useGeoPdfImportRun();
  const geoPdfBusy = importRun !== null;

  // The list is only refreshed by registry notifications, which fire before the
  // artifact's size is known; a finished import changes what the capacity meter
  // should read, so recompute when a run ends.
  const runEnded = importRun === null;
  useEffect(() => {
    if (runEnded) refreshFreeSpace();
  }, [runEnded, refreshFreeSpace]);

  const handleImportGeoPdf = useCallback(() => {
    void runGeoPdfImport("GeoPDF", (onProgress, token) =>
      importGeoPdfFromPicker(onProgress, token),
    );
    // Land on the tab the new row will appear in, rather than making the user
    // find it once the toast has been and gone.
    setFilter("geoPdf");
  }, []);

  const handleResumeGeoPdf = useCallback((id: string, label: string) => {
    void runGeoPdfImport(label, (onProgress, token) =>
      resumeGeoPdfImport(id, onProgress, token),
    );
  }, []);

  // Import your own server-generated GeoPDFs: list the account's completed
  // jobs on demand (online-only), then stream a chosen one's presigned bytes
  // into the same on-device pipeline. Loaded lazily on a tap, not on mount.
  const [accountJobs, setAccountJobs] = useState<GeoPdfJobView[] | null>(null);
  const [accountJobsLoading, setAccountJobsLoading] = useState(false);

  const loadAccountGeoPdfs = useCallback(async () => {
    try {
      setAccountJobsLoading(true);
      const jobs = await listGeoPdfJobs();
      const completed = jobs.filter((job) => job.status === "completed");
      setAccountJobs(completed);
      setFilter("geoPdf");
      if (completed.length === 0) info("No generated GeoPDFs on your account yet.");
    } catch (err) {
      console.error(err);
      fail(messageFromError(err, "Couldn't load your GeoPDFs."));
    } finally {
      setAccountJobsLoading(false);
    }
  }, [fail, info]);

  const handleImportAccountGeoPdf = useCallback((job: GeoPdfJobView) => {
    const label = job.title ?? "GeoPDF";
    void runGeoPdfImport(label, async (onProgress, token) => {
      // Re-presign right before download — the listed URL may have expired
      // while this list was open.
      const fresh = await getGeoPdfJob(job.id);
      if (!fresh.downloadUrl) throw new Error("This GeoPDF isn't ready to download.");
      return importGeoPdfFromUrl(
        fresh.title ?? "Logjam GeoPDF",
        fresh.downloadUrl,
        onProgress,
        token,
      );
    });
    setFilter("geoPdf");
  }, []);

  // --- Tracks ---
  const { tracks } = useTracks();
  const savedTracks = tracks.filter((track) => track.state === "done");

  // --- Unified on-device item list ---
  const items = useMemo<SavedItem[]>(() => {
    const rows: SavedItem[] = [];

    for (const artifact of regionArtifacts) {
      rows.push({
        key: artifact.id,
        category: "region",
        title: artifact.label ?? "Offline map region",
        subtitle: `Basemap · saved ${formatDay(artifact.downloadedAt)}`,
        sizeBytes: artifact.sizeBytes,
        locatable: artifact.bbox != null,
        // A basemap region's logicalKey IS the basemap it holds tiles for.
        focusBasemapId: artifact.logicalKey as BasemapId,
        resolveBbox: async () => artifact.bbox,
        rename: (name) => renameArtifact(artifact.id, name),
        delete: {
          confirmTitle: "Delete this region?",
          confirmBody: "The offline basemap tiles for this area are removed from the device.",
          run: () => deleteDownloadedArtifact(artifact.id),
        },
      });
    }

    for (const overlay of overlayCatalog) {
      const saved = artifacts.find(
        (a) => a.kind === "topo-overlay" && a.logicalKey === overlay.key,
      );
      if (!saved) continue;
      rows.push({
        key: saved.id,
        category: "overlay",
        title: saved.label ?? overlay.label,
        subtitle: "LiDAR topo · on device",
        sizeBytes: saved.sizeBytes,
        pill: { label: "Offline", tone: "accent" },
        locatable: saved.bbox != null,
        resolveBbox: async () => saved.bbox,
        rename: (name) => renameArtifact(saved.id, name),
        delete: {
          confirmTitle: "Delete this overlay?",
          confirmBody: "The overlay is removed from the device. You can download it again later.",
          run: () => deleteDownloadedArtifact(saved.id),
        },
      });
    }

    for (const geoPdf of geoPdfImports) {
      // The row for the import that is running right now is suppressed: the
      // progress card above the list is already showing it, and its registry
      // state ("rasterising") would otherwise render here as "Unfinished" with
      // a Resume button, i.e. an invitation to start a second run of the very
      // import in progress.
      if (importRun?.importId === geoPdf.id) continue;
      const failed = geoPdf.state === "failed";
      const incomplete = geoPdf.state !== "ready" && !failed;
      // An imported GeoPDF costs the source PDF *plus* the MBTiles rendered
      // from it, which is the far larger half and lives in the artifact
      // registry under this import's id. Counting only the source under-reports
      // storage by an order of magnitude.
      const tiles = artifacts.find(
        (a) => a.kind === "geopdf-import" && a.logicalKey === geoPdf.id,
      );
      rows.push({
        key: geoPdf.id,
        category: "geoPdf",
        title: geoPdf.label,
        subtitle: failed
          ? (geoPdf.errorCode && GEOPDF_ERRORS[geoPdf.errorCode]) || "Import failed."
          : incomplete
            ? "GeoPDF · import unfinished"
            : `GeoPDF · imported ${formatDay(geoPdf.createdAt)}`,
        sizeBytes: geoPdf.sourceSizeBytes + (tiles?.sizeBytes ?? 0),
        ...(failed
          ? { pill: { label: "Failed", tone: "warning" as const } }
          : incomplete
            ? { pill: { label: "Unfinished", tone: "muted" as const } }
            : {}),
        ...(geoPdf.state !== "ready" && !geoPdfBusy
          ? {
              inlineAction: {
                icon: "refresh-cw" as const,
                label: "Resume this import",
                onPress: () => handleResumeGeoPdf(geoPdf.id, geoPdf.label),
              },
            }
          : {}),
        ...geoPdfActions(geoPdf),
      });
    }

    for (const route of routes.data ?? []) {
      const shared = route.syncRole === "shared";
      rows.push({
        key: route.id,
        category: "route",
        title: route.name,
        // Length is DERIVED, never stored — a saved length goes stale the
        // moment a vertex moves.
        subtitle: `${formatDistanceM(routeLengthM(route.points))} · ${
          shared ? "shared with you" : `drawn ${formatDay(route.createdAt)}`
        }`,
        // Routes live in the sync mirror as a row of coordinates, not as a file
        // on this device, so they take no meaningful storage. Same deliberate
        // treatment as recorded tracks.
        sizeBytes: 0,
        ...(shared ? { pill: { label: "Shared", tone: "muted" as const } } : {}),
        ...routeActions(route),
      });
    }

    for (const imported of imports) {
      rows.push({
        key: imported.id,
        category: "vector",
        title: imported.name,
        subtitle: `${imported.featureCount} feature${imported.featureCount === 1 ? "" : "s"} · imported ${formatDay(imported.createdAt)}`,
        sizeBytes: imported.sizeBytes,
        ...vectorImportActions(imported),
      });
    }

    for (const track of savedTracks) {
      rows.push({
        key: track.id,
        category: "track",
        title: track.name,
        subtitle: `${formatDistanceM(track.distanceM)} · recorded ${formatDay(track.startedAt)}`,
        // Tracks are DB rows, not files — they carry no meaningful on-disk
        // size, so they stay out of the capacity meter.
        sizeBytes: 0,
        ...trackActions(track),
      });
    }

    return rows;
  }, [
    artifacts,
    geoPdfBusy,
    importRun?.importId,
    routes.data,
    geoPdfImports,
    handleResumeGeoPdf,
    imports,
    overlayCatalog,
    regionArtifacts,
    savedTracks,
  ]);

  const counts = useMemo(() => {
    const byCategory = { region: 0, overlay: 0, geoPdf: 0, route: 0, vector: 0, track: 0 };
    for (const item of items) byCategory[item.category] += 1;
    return byCategory;
  }, [items]);

  const segments = useMemo<CapacitySegment[]>(
    () =>
      CATEGORY_ORDER.map((category) => {
        const bytes = items
          .filter((item) => item.category === category)
          .reduce((sum, item) => sum + item.sizeBytes, 0);
        return {
          label: CATEGORY_META[category].plural,
          value: bytes,
          color: assetHue[category],
          display: formatBytes(bytes),
        };
      }),
    [items],
  );

  const usedBytes = segments.reduce((sum, segment) => sum + segment.value, 0);

  const filterOptions: SegmentOption<Category | "all">[] = [
    { value: "all", label: "All", count: items.length },
    ...CATEGORY_ORDER.map((category) => ({
      value: category,
      label: CATEGORY_META[category].plural,
      count: counts[category],
      hue: assetHue[category],
    })),
  ];

  // "All" is size-descending — the order that answers "what is filling the
  // device". Within a category, insertion order (newest registry rows last)
  // is more useful than size.
  const visibleItems =
    filter === "all"
      ? [...items].sort((a, b) => b.sizeBytes - a.sizeBytes)
      : items.filter((item) => item.category === filter);

  const availableOverlays = overlayCatalog.filter(
    (overlay) =>
      !artifacts.some((a) => a.kind === "topo-overlay" && a.logicalKey === overlay.key),
  );

  const deleteItem = useCallback(
    (item: SavedItem) => {
      Alert.alert(item.delete.confirmTitle, item.delete.confirmBody, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            item.delete
              .run()
              .then(refreshFreeSpace)
              .catch((err: unknown) => {
                console.error(err);
                fail(messageFromError(err, "Couldn't delete that."));
              });
          },
        },
      ]);
    },
    [fail, refreshFreeSpace],
  );

  /** Recording → route. Says how many points survived, because RDP always
   *  throws some away and silently handing back a coarser line is how the user
   *  concludes the app lost their track. */
  const createRouteFromItem = useCallback(
    (item: SavedItem) => {
      item.createRouteFrom?.().then(
        ({ name, pointCount }) =>
          info(`Saved “${name}” — ${pointCount} points. The recording is unchanged.`),
        (err: unknown) => {
          console.error(err);
          fail(messageFromError(err, "Couldn't make a route from that."));
        },
      );
    },
    [fail, info],
  );

  /** Recording → file on the handset. Mirrors RouteOptionsSheet's save(). */
  const exportItem = useCallback(
    (item: SavedItem, format: ExportFormat) => {
      item.exportFile?.(format).then(
        (filename) => {
          // Null = the user backed out of the folder picker. Not a failure,
          // and a toast claiming success would be a lie.
          if (filename) info(`Saved ${filename}.`);
        },
        (err: unknown) => {
          if (err instanceof ExportUnsupportedError) {
            fail(err.message);
            return;
          }
          console.error(err);
          fail("Couldn't save that file.");
        },
      );
    },
    [fail, info],
  );

  const showOnMap = useCallback(
    (item: SavedItem) => {
      item
        .resolveBbox()
        .then((bbox) => {
          if (!bbox) {
            fail("This one has no saved location to show.");
            return;
          }
          onOpenMap(bbox, item.focusBasemapId);
        })
        .catch((err: unknown) => {
          console.error(err);
          fail("Couldn't work out where this is.");
        });
    },
    [fail, onOpenMap],
  );

  const menuItem = items.find((item) => item.key === menuItemKey) ?? null;
  // A route's overflow is the SAME sheet the map shows, so the two surfaces
  // cannot offer different verbs for the same object (DESIGN.md §7). Rename is
  // the exception: the form lives in the generic sheet, so choosing it hands
  // back to that one.
  const menuRoute =
    menuItem?.category === "route"
      ? ((routes.data ?? []).find((route) => route.id === menuItem.key) ?? null)
      : null;
  const showRouteSheet = menuRoute !== null && menuMode !== "rename";
  const [statsRoute, setStatsRoute] = useState<MirrorRoute | null>(null);
  const [linkingRoute, setLinkingRoute] = useState<MirrorRoute | null>(null);

  return (
    <View style={styles.screen}>
      <HeroHeader
        eyebrow="Saved for offline use"
        title="On this device"
        value={formatBytes(usedBytes)}
        valueSuffix={freeBytes != null ? `used · ${formatBytes(freeBytes)} free` : "used"}
        action={<Button label="Add" icon="plus" compact onPress={() => setAddSheetOpen(true)} />}
      >
        <CapacityBar segments={segments} />
        {/* Offline is a normal state here — everything already on the device
            still works — so it sits beside what is still waiting to leave
            rather than reading as an error. */}
        <SyncStatusPills online={online} pendingCount={pendingCount} />
      </HeroHeader>

      <View style={styles.rail}>
        <SegmentedControl
          options={filterOptions}
          value={filter}
          onChange={selectFilter}
          scroll
        />
      </View>

      {/* Hero + rail stay pinned; only the inventory scrolls, so the filter
          you are working in never scrolls out of reach. */}
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {activeOp ? (
          <Row
            title={activeOp.label}
            subtitle={
              activeOp.fraction != null
                ? `${Math.round(activeOp.fraction * 100)}%`
                : "Working…"
            }
            icon="download-cloud"
            hue={assetHue[activeOp.category]}
            progress={activeOp.fraction ?? 0}
          />
        ) : null}

        {/* A running GeoPDF import, as a card the user can walk away from.
            Separate from `activeOp` above rather than folded into it: this one
            is not owned by this screen, so it must survive the screen
            unmounting and be here again when the user comes back. */}
        {importRun ? (
          <Row
            title={importRun.label}
            subtitle={
              importRun.fraction != null
                ? `${GEOPDF_PHASE_LABEL[importRun.phase]} · ${Math.round(importRun.fraction * 100)}%`
                : GEOPDF_PHASE_LABEL[importRun.phase]
            }
            icon="file-text"
            hue={assetHue.geoPdf}
            progress={importRun.fraction ?? 0}
            right={
              <IconButton
                icon="x"
                // Honest about which half of the run this reaches: the token is
                // read between rasteriser batches, so during the front phases
                // there is nothing yet for it to interrupt.
                accessibilityLabel="Cancel this import"
                onPress={cancelGeoPdfImportRun}
                disabled={!CANCELLABLE_PHASES.includes(importRun.phase)}
              />
            }
          />
        ) : null}

        {visibleItems.length === 0 && !activeOp && !importRun ? (
          <EmptyPanel filter={filter} online={online} onAdd={() => setAddSheetOpen(true)} />
        ) : null}

        {visibleItems.map((item) => (
          <Row
            key={item.key}
            title={item.title}
            subtitle={item.subtitle}
            icon={CATEGORY_META[item.category].icon}
            hue={assetHue[item.category]}
            right={
              <View style={styles.rowActions}>
                {item.sizeBytes > 0 ? (
                  <Text style={styles.size}>{formatBytes(item.sizeBytes)}</Text>
                ) : null}
                {item.pill ? <StatusPill label={item.pill.label} tone={item.pill.tone} /> : null}
                {item.inlineAction ? (
                  <IconButton
                    icon={item.inlineAction.icon}
                    accessibilityLabel={item.inlineAction.label}
                    color={theme.accent}
                    onPress={item.inlineAction.onPress}
                  />
                ) : null}
                <IconButton
                  icon="more-vertical"
                  accessibilityLabel={`Actions for ${item.title}`}
                  onPress={() => openItemSheet(item.key)}
                />
              </View>
            }
          />
        ))}

        {/* The account's overlay catalogue is a background fetch, so its
            failure is only worth reporting inside the filter that needs it. */}
        {filter === "overlay" && overlaysQuery.error ? (
          <Row
            title="Couldn't reach the server"
            subtitle="Your saved overlays still work offline."
            icon="cloud-off"
            hue={theme.warning}
            right={
              <IconButton
                icon="refresh-cw"
                accessibilityLabel="Try loading your overlays again"
                color={theme.accent}
                onPress={overlaysQuery.refetch}
              />
            }
          />
        ) : null}

        {/* The one list of things NOT on the device: server-side LiDAR topo
            overlays this account can pull down. Scoped to this filter so "All"
            stays an inventory of what is actually here. */}
        {filter === "overlay" && availableOverlays.length > 0 ? (
          <>
            <SectionHeader label="Available to download" />
            {availableOverlays.map((overlay) => (
              <Row
                key={overlay.key}
                title={overlay.label}
                subtitle={lidarReady ? "Not on this device" : "Connect to download"}
                icon="layers"
                hue={assetHue.overlay}
                right={
                  <IconButton
                    icon="download"
                    accessibilityLabel={`Save ${overlay.label} for offline use`}
                    color={theme.accent}
                    disabled={!lidarReady || overlayBusyKey != null}
                    onPress={() => handleSaveOverlay(overlay)}
                  />
                }
              />
            ))}
          </>
        ) : null}

        {filter === "geoPdf" && accountJobs != null && accountJobs.length > 0 ? (
          <>
            <SectionHeader label="In your Logjam account" />
            {accountJobs.map((job) => (
              <Row
                key={job.id}
                title={job.title ?? "Untitled GeoPDF"}
                subtitle={
                  job.resultBytes != null
                    ? `${formatBytes(job.resultBytes)} · not on this device`
                    : "Not on this device"
                }
                icon="file-text"
                hue={assetHue.geoPdf}
                right={
                  <IconButton
                    icon="download"
                    accessibilityLabel={`Import ${job.title ?? "this GeoPDF"} to this device`}
                    color={theme.accent}
                    disabled={geoPdfBusy}
                    onPress={() => handleImportAccountGeoPdf(job)}
                  />
                }
              />
            ))}
          </>
        ) : null}
      </ScrollView>

      <BottomSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title="Add to this device"
      >
        <View style={styles.sheetBody}>
          <Row
            title="Download a map region"
            subtitle={
              online
                ? "Frame an area, pick the maps and the detail"
                : "Needs a connection"
            }
            icon="map"
            hue={assetHue.region}
            disabled={!online}
            onPress={() => {
              setAddSheetOpen(false);
              onDownloadRegion();
            }}
          />
          <Row
            title="Import a GeoPDF file"
            subtitle="From this phone's storage — works offline"
            icon="file-text"
            hue={assetHue.geoPdf}
            onPress={() => {
              setAddSheetOpen(false);
              handleImportGeoPdf();
            }}
          />
          <Row
            title={accountJobsLoading ? "Loading your GeoPDFs…" : "GeoPDFs from my account"}
            subtitle="Maps you generated on the web"
            icon="cloud"
            hue={assetHue.geoPdf}
            {...capabilityRowProps("accountGeoPdf", accountState, online)}
            onPress={
              accountGeoPdfReady && !accountJobsLoading
                ? () => {
                    setAddSheetOpen(false);
                    loadAccountGeoPdfs();
                  }
                : undefined
            }
          />
          <Row
            title="Import GPX, KML or GeoJSON"
            subtitle="From this phone's storage — works offline"
            icon="file-plus"
            hue={assetHue.vector}
            onPress={
              importBusy
                ? undefined
                : () => {
                    setAddSheetOpen(false);
                    handleImportFile();
                  }
            }
          />
          <Row
            title="Save a LiDAR topo overlay"
            subtitle="Contours, slope and vegetation you generated"
            icon="layers"
            hue={assetHue.overlay}
            {...capabilityRowProps("lidarOverlays", accountState, online)}
            onPress={
              lidarReady
                ? () => {
                    setAddSheetOpen(false);
                    setFilter("overlay");
                  }
                : undefined
            }
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={menuItem != null && !showRouteSheet}
        onClose={closeItemSheet}
        title={
          menuItem == null
            ? ""
            : menuMode === "rename"
              ? `Rename ${CATEGORY_META[menuItem.category].label.toLowerCase()}`
              : menuItem.title
        }
      >
        <View style={styles.sheetBody}>
          {menuItem == null ? null : menuMode === "rename" ? (
            <RenameForm
              item={menuItem}
              onDone={closeItemSheet}
              onError={fail}
            />
          ) : (
            <>
              {menuItem.locatable ? (
                <Row
                  title="Show on map"
                  icon="map-pin"
                  hue={assetHue[menuItem.category]}
                  onPress={() => {
                    const target = menuItem;
                    closeItemSheet();
                    showOnMap(target);
                  }}
                />
              ) : null}
              {menuItem.createRouteFrom ? (
                <Row
                  title="Create route from this"
                  icon="pen-tool"
                  hue={assetHue.route}
                  onPress={() => {
                    const target = menuItem;
                    closeItemSheet();
                    createRouteFromItem(target);
                  }}
                />
              ) : null}
              {menuItem.exportFile ? (
                <>
                  <Row
                    title="Save as GPX"
                    icon="download"
                    hue={theme.bonus1}
                    onPress={() => {
                      const target = menuItem;
                      closeItemSheet();
                      exportItem(target, "gpx");
                    }}
                  />
                  <Row
                    title="Save as KML"
                    icon="download"
                    hue={theme.bonus1}
                    onPress={() => {
                      const target = menuItem;
                      closeItemSheet();
                      exportItem(target, "kml");
                    }}
                  />
                </>
              ) : null}
              <Row
                title="Rename"
                icon="edit-2"
                hue={theme.bonus1}
                onPress={() => setMenuMode("rename")}
              />
              {/* Every asset that reaches THIS sheet is a file on this
                  handset. A route is not — it is a synced record whose delete
                  removes it from the account — which is why routes get their
                  own sheet rather than this label with a branch in it. */}
              <Row
                title="Delete from device"
                icon="trash-2"
                hue={theme.warning}
                onPress={() => {
                  const target = menuItem;
                  closeItemSheet();
                  deleteItem(target);
                }}
              />
            </>
          )}
        </View>
      </BottomSheet>

      <RouteOptionsSheet
        route={menuRoute}
        visible={showRouteSheet}
        onClose={closeItemSheet}
        onViewStats={() => {
          setStatsRoute(menuRoute);
          closeItemSheet();
        }}
        onShowOnMap={() => {
          const target = menuItem;
          closeItemSheet();
          if (target) showOnMap(target);
        }}
        onEdit={() => {
          const routeId = menuRoute?.id;
          closeItemSheet();
          if (routeId) onEditRoute(routeId);
        }}
        onRename={() => setMenuMode("rename")}
        onLinkCanyon={() => {
          setLinkingRoute(menuRoute);
          closeItemSheet();
        }}
        onInfo={info}
        onError={fail}
      />

      <RouteStatsSheet
        route={statsRoute}
        visible={statsRoute !== null}
        onClose={() => setStatsRoute(null)}
        onViewOptions={() => {
          const target = statsRoute;
          setStatsRoute(null);
          if (target) openItemSheet(target.id);
        }}
      />

      <LinkCanyonSheet
        route={linkingRoute}
        visible={linkingRoute !== null}
        onClose={() => setLinkingRoute(null)}
        onInfo={info}
        onError={fail}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

// Per-filter empty states: each one names the thing that is missing and offers
// the action that fixes it, rather than a shared grey "nothing here".
function EmptyPanel({
  filter,
  online,
  onAdd,
}: {
  filter: Category | "all";
  online: boolean;
  onAdd: () => void;
}) {
  // An empty panel is where someone works out whether a feature is missing or
  // merely unused — so for the two account-backed categories it must say which.
  const isGuest = useAccountState().accountState === "guest";
  const copy: Record<Category | "all", { title: string; hint: string }> = {
    route: {
      title: "No routes yet",
      hint: "Draw one on the map with the pen tool — the approach, the creek, the exit.",
    },
    all: {
      title: "Nothing saved yet",
      hint: "Canyons need maps that work with no signal. Save a region before you leave town.",
    },
    region: {
      title: "No offline basemap",
      hint: "Without a saved region the map is blank once you lose signal.",
    },
    overlay: {
      title: "No LiDAR topos here",
      hint: isGuest
        ? "LiDAR topos are generated on the web and need a Logjam account."
        : online
          ? "Topo overlays you generate on the web can be saved for offline use."
          : "Connect to see the overlays on your account.",
    },
    geoPdf: {
      title: "No GeoPDF maps",
      hint: isGuest
        ? "Import a GeoPDF from this phone. Pulling one from a Logjam account needs an account."
        : "Import a GeoPDF from this phone, or pull one from your Logjam account.",
    },
    vector: {
      title: "No GPX or KML files",
      hint: "Bring in GPX, KML or GeoJSON from another app to see it on the map.",
    },
    track: {
      title: "No recorded tracks",
      hint: "Tracks you record on the Map tab are saved here.",
    },
  };
  const { title, hint } = copy[filter];
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
      {filter !== "track" ? (
        <Button label="Add to device" icon="plus" compact onPress={onAdd} />
      ) : null}
    </View>
  );
}

// The rename form, rendered INSIDE the item sheet (never as its own Modal —
// see the `menuMode` comment). Because the sheet is already open and focused
// when this mounts, focus can be claimed on the first frame and the keyboard
// rises together with the form appearing, instead of shoving a settled sheet
// upwards a beat later.
function RenameForm({
  item,
  onDone,
  onError,
}: {
  item: SavedItem;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(item.title);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // `autoFocus` runs before the field is attached and is unreliable here; an
    // explicit focus on the next frame is not.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const commit = useCallback(() => {
    const name = draft.trim();
    if (!name || name === item.title) {
      onDone();
      return;
    }
    item.rename(name).catch((err: unknown) => {
      console.error(err);
      onError(messageFromError(err, "Couldn't rename that."));
    });
    onDone();
  }, [draft, item, onDone, onError]);

  return (
    <>
      <TextField
        label="Name"
        value={draft}
        onChangeText={setDraft}
        inputRef={inputRef}
        returnKeyType="done"
        onSubmitEditing={commit}
      />
      <Button label="Save" icon="check" onPress={commit} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.primary },
  // The rail's own bottom pad is the gap the list scrolls against — without it
  // rows slide flush into the chips.
  rail: { paddingLeft: spacing(2), paddingTop: spacing(1.5), paddingBottom: spacing(1.5) },
  body: { paddingHorizontal: spacing(2), paddingBottom: spacing(4), gap: spacing(1) },
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  size: { color: theme.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  sheetBody: { gap: spacing(1) },
  empty: {
    alignItems: "center",
    gap: spacing(1),
    paddingVertical: spacing(4),
    paddingHorizontal: spacing(2),
  },
  emptyTitle: {
    color: theme.textPrimary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  emptyHint: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
    maxWidth: 300,
  },
});
