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
//     map, rename it, delete it. Press and hold one to start a multi-select;
//     the contextual bar then takes the filter rail's slot and offers the
//     group verbs (show on map, select all, delete).
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
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useFocusEffect } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";

import {
  BASEMAP_CATALOG,
  TOPO_LAYERS,
  formatDistanceM,
  isValidLatitude,
  isValidLongitude,
  routeLengthM,
  messageFromError,
  type TopoLayerFormat,
  type TopoLayerName,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { formatBytes, formatMinutes } from "../format";
import { getGeoPdfJob, listGeoPdfJobs, type GeoPdfJobView } from "../api/geoPdfJobs";
import { useApiQuery } from "../api/queries";
import {
  useMirrorRoutes,
  useMirrorWaypoints,
  usePendingSyncCount,
} from "../sync/useSyncQueries";
import { assetHue, fontSize, fontWeight, spacing, theme } from "../theme";
import {
  BottomSheet,
  Button,
  CapacityBar,
  HeroHeader,
  IconButton,
  RenameForm,
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
import type { BasemapId, MapArtifact } from "../map/sourceResolver";
import { mergeSavedOverlayJobs, type CompletedOverlaysResponse } from "../map/topoOverlays";
import { downloadTopoOverlay } from "../offline/overlayDownloads";
import { deleteDownloadedArtifact } from "../offline/regionDownloads";
import { renameArtifact, renameArtifactGroup } from "../offline/registryDb";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import {
  groupArtifacts,
  overlayJobId,
  regionGroupKey,
} from "../offline/artifactGroups";
import { groupRegionJobs } from "../offline/regionDownloadGroups";
import {
  deleteRegionFile,
  listUnfinishedRegions,
  type UnfinishedRegion,
} from "../offline/regionMbtiles";
import {
  cancelRegionDownload,
  enqueueRegionDownloads,
  useRegionDownloads,
} from "../offline/regionDownloadQueue";
import { RegionDownloadRow } from "../offline/RegionDownloadRow";
import { useElevationProfile } from "../map/useElevationProfile";
import { TrackStatsBody } from "../tracks/TrackStatsBody";
import { useTrackDetail } from "../tracks/useTrackDetail";
import { useImportedTrackDetail } from "../imports/useImportedTrackDetail";
import {
  SHARED_READ_ONLY_HINT,
  geoPdfActions,
  trackActions,
  routeActions,
  vectorImportActions,
  waypointActions,
} from "./assetActions";
import { useTracks } from "../tracks/useTracks";
import { ExportUnsupportedError, type ExportFormat } from "../fileExport";
import type { Bbox } from "./bboxOfPoints";
import { bulkDeleteConfirmBody } from "./bulkDeleteConfirm";
import type { MirrorRoute } from "../sync/mirrorStore";
import { createWaypointLocal, updateWaypointLocal } from "../sync/outbox";
import { takePickedPoint } from "../map/pickedPoint";
import type { PickedPoint } from "../map/PickPointScreen";
import {
  WaypointCanyonFilter,
  WaypointCanyonsBody,
  WaypointFormBody,
  type WaypointFormDraft,
  type WaypointFormFields,
  WaypointSubModeHeader,
  WaypointTagsBody,
} from "../waypoints/waypointSheetBodies";
import { RouteOptionsSheet } from "../routes/RouteOptionsSheet";
import { RouteStatsSheet } from "../routes/RouteStatsSheet";
import { LinkCanyonSheet } from "../routes/LinkCanyonSheet";


function getCompletedOverlays(): Promise<CompletedOverlaysResponse> {
  return apiFetch<CompletedOverlaysResponse>("/topo-jobs/completed-overlays");
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A basemap-region artifact's logicalKey IS the basemap it holds tiles for. */
function basemapName(logicalKey: string): string {
  return BASEMAP_CATALOG.find((entry) => entry.id === logicalKey)?.name ?? "Basemap";
}

/** What one row of a region card is, listed under the ⋯ sheet. */
function regionMemberName(artifact: MapArtifact): string {
  return artifact.kind === "dem-region"
    ? "Elevation data"
    : basemapName(artifact.logicalKey);
}

/** A topo-overlay artifact's logicalKey is `<jobId>/<layer>`. */
function topoLayerLabel(logicalKey: string): string {
  const layer = logicalKey.slice(logicalKey.indexOf("/") + 1);
  return TOPO_LAYERS.find((meta) => meta.name === layer)?.label ?? layer;
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// --- Category model -------------------------------------------------------
// One entry per asset kind: the filter rail, the capacity meter and every
// row's glyph/hue all read from here, so a new asset kind is one addition.
export type Category =
  | "region"
  | "overlay"
  | "geoPdf"
  | "route"
  | "waypoint"
  | "vector"
  | "track";

/** Enough to turn a saved item's layer on when it is shown on the map. */
export type SavedItemReveal = {
  category: Category;
  /** The item's key: its id, or `region:<id>` / `overlay:<id>` for registry rows. */
  key: string;
};

const CATEGORY_META: Record<
  Category,
  {
    label: string;
    plural: string;
    icon:
      | "map"
      | "layers"
      | "file-text"
      | "file-plus"
      | "activity"
      | "edit-3"
      | "map-pin";
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
  // Marked points. Like routes they are synced records rather than files on
  // this device, and they are the one kind here that can be SEARCHED and
  // filtered by tag — see the waypoint filter rail below.
  waypoint: { label: "Waypoint", plural: "Waypoints", icon: "map-pin" },
  vector: { label: "GPX / KML", plural: "GPX & KML", icon: "file-plus" },
  track: { label: "Track", plural: "Tracks", icon: "activity" },
};

// Reading order for the filter rail, the capacity meter and the "add to this
// device" sheet, which all derive from it: the maps you stand on first
// (basemap, topo, paper sheet), then the things you place on them, then the
// files you bring in from elsewhere.
const CATEGORY_ORDER: Category[] = [
  "region",
  "overlay",
  "geoPdf",
  "waypoint",
  "track",
  "route",
  "vector",
];

/** A single on-device asset, flattened so one renderer covers every kind. */
type SavedItem = {
  key: string;
  category: Category;
  title: string;
  /** Absent where a subtitle would only restate the filter or the pill. */
  subtitle?: string;
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
  /** Persist a new display name. Absent on a shared route or waypoint, which
   *  is read-only — see `AssetActions.rename`. */
  rename?: (name: string) => Promise<unknown>;
  /**
   * The files behind ONE card. A region download writes one artifact per
   * basemap and a LiDAR topo job one per layer; the card is the thing the user
   * asked for, and this is what it is made of — listed in the ⋯ sheet with a
   * size each and a delete each, so a single basemap can go without losing the
   * area.
   */
  members?: {
    id: string;
    title: string;
    sizeBytes: number;
    delete: () => Promise<unknown>;
  }[];
  /** Absent on an asset this user may not delete — see `AssetActions.delete`.
   *  Such a row offers no Delete in its sheet and cannot be multi-selected,
   *  because deleting is the only thing a selection does. */
  delete?: { confirmTitle: string; confirmBody: string; run: () => Promise<unknown> };
  /** Present on an editable route — the map's draw tool reopens this id. */
  editableRouteId?: string;
  /** Present on an editable route: flip vertex order (direction is semantic). */
  reverse?: () => Promise<unknown>;
  /** Present on a recording: make an editable route from it, non-destructively. */
  createRouteFrom?: () => Promise<{ name: string; pointCount: number }>;
  /** Present on a recording: save it out as a GPX or KML file. */
  exportFile?: (format: ExportFormat) => Promise<string | null>;
  /**
   * What the waypoint search matches against, and the tags its chip rail
   * filters by. Only waypoints carry it — see the rail render below for why
   * this is not a screen-wide search.
   */
  search?: { haystack: string; tags: string[] };
};

export function SavedScreen({
  onOpenMap,
  onDownloadRegion,
  onEditRoute,
  onPickPoint,
  onContinueRecording,
  onRecordTrack,
  onDrawRoute,
  initialFilter,
}: {
  onOpenMap: (bbox?: Bbox, basemapId?: BasemapId, reveal?: SavedItemReveal) => void;
  onDownloadRegion: () => void;
  /** Open the map's draw tool on an existing route. Editing is a map gesture,
   *  so this screen hands it over rather than growing an editor of its own. */
  onEditRoute: (routeId: string) => void;
  /**
   * Open the full-screen point picker for the coordinate form, starting on
   * `from` when it already holds one. The answer comes back through
   * `map/pickedPoint.ts`, collected when this screen regains focus.
   */
  onPickPoint: (
    from: { latitude: number; longitude: number } | null,
    /** The waypoint being moved, so the picker can leave its pin off. */
    hideWaypointId?: string,
  ) => void;
  /**
   * Pick a finished recording back up. Handed to the MAP rather than done here:
   * arming the recorder needs the location prompt, which cannot be raised from
   * an open sheet (DESIGN.md §7), and the map is what has to end up in
   * recording mode.
   */
  onContinueRecording: (trackId: string) => void;
  /** Start a new recording. Handed to the map for the same two reasons
   *  `onContinueRecording` is. */
  onRecordTrack: () => void;
  /** Arm the pen on the map with nothing linked — a route drawn from here
   *  belongs to no canyon until the user says otherwise. */
  onDrawRoute: () => void;
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
  const [menuMode, setMenuMode] = useState<
    "actions" | "rename" | "tags" | "canyons" | "stats"
  >("actions");
  // Filter text for the canyon sub-mode, pinned in the sheet header.
  const [menuCanyonQuery, setMenuCanyonQuery] = useState("");
  /**
   * What the waypoint form had in it when it left for the map picker, and what
   * the picker sent back.
   *
   * They live HERE rather than in the form because the form is inside a
   * `BottomSheet` — an RN Modal, which would cover a full-screen map, so the
   * sheet has to close and the body unmounts with it. One pair of fields for
   * both forms: only one of them can be open at a time.
   */
  const [waypointDraft, setWaypointDraft] = useState<WaypointFormDraft | null>(null);
  const [pickedCoords, setPickedCoords] = useState<PickedPoint | null>(null);
  /** Which form is away at the picker, and therefore hidden rather than
   *  closed. Null the rest of the time. */
  const [pickerAway, setPickerAway] = useState<"create" | "edit" | null>(null);
  /** Read by the focus effect below, which must not re-subscribe when it
   *  changes — the established mirror-ref pattern. */
  const pickerAwayRef = useRef(pickerAway);
  pickerAwayRef.current = pickerAway;

  const closeItemSheet = useCallback(() => {
    setMenuItemKey(null);
    setMenuMode("actions");
    setWaypointDraft(null);
    setPickedCoords(null);
  }, []);
  const openItemSheet = useCallback((key: string) => {
    setMenuMode("actions");
    setMenuItemKey(key);
  }, []);

  // --- Multi-select ---------------------------------------------------------
  // Press and hold any row to start picking; a tap then toggles. Held as KEYS,
  // not items: the list is rebuilt on every registry/mirror notification, and a
  // key whose row has since been deleted simply stops matching (below), so a
  // bulk delete can't leave the bar counting things that are gone.
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const clearSelection = useCallback(() => setSelectedKeys([]), []);
  const toggleSelected = useCallback((key: string) => {
    setSelectedKeys((keys) =>
      keys.includes(key) ? keys.filter((other) => other !== key) : [...keys, key],
    );
  }, []);
  /**
   * Deleting is the only thing a selection does, so an asset the user may not
   * delete — a route or waypoint shared with them — has nothing to be picked
   * for. The row is greyed out while selecting instead of toasting: a dead row
   * says "not pickable" at a glance, which a toast only said after the tap.
   */
  const selectItem = useCallback(
    (item: SavedItem) => {
      if (!item.delete) return;
      toggleSelected(item.key);
    },
    [toggleSelected],
  );

  // Leaving the tab drops any open per-item sheet: coming back to a rename form
  // for a row you have since navigated away from is a stale prompt, not a
  // resumed task. The trip to the point picker is the exception — that is one
  // task, not two, and it is the only blur that leaves the sheet standing.
  useFocusEffect(
    useCallback(() => {
      refreshFreeSpace();
      // Back from the point picker. `takePickedPoint` consumes the value, so an
      // ordinary later return to this tab cannot re-apply a coordinate that has
      // since been typed over.
      const away = pickerAwayRef.current;
      if (away) {
        setPickerAway(null);
        const point = takePickedPoint();
        // Already trimmed to a sane number of decimals by the store.
        if (point) setPickedCoords(point);
        // The edit form is reached through the item sheet, which was left
        // mounted and simply hidden — nothing to reopen.
        if (away === "create") setCoordSheetOpen(true);
      }
      return () => {
        if (pickerAwayRef.current) return;
        closeItemSheet();
        // A selection is a transient mode over rows you can see. Coming back to
        // the tab holding a pending "delete these five" you no longer remember
        // making is the same stale prompt an abandoned rename would be.
        clearSelection();
      };
    }, [clearSelection, closeItemSheet, refreshFreeSpace]),
  );

  // Changing category is changing subject — abandon an in-progress rename with
  // it rather than leaving a form floating over a list it no longer belongs to.
  // Same for a selection: its bar replaces the rail, so this only fires from a
  // navigation handoff, and carrying invisible rows into a bulk delete is how
  // someone deletes a region they cannot see.
  const selectFilter = useCallback(
    (next: Category | "all") => {
      closeItemSheet();
      clearSelection();
      setFilter(next);
    },
    [clearSelection, closeItemSheet],
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
  // The DEM saved with a run belongs to that run's card: its bytes are part of
  // what the area cost, and deleting the area has to take it with it. It is not
  // one of the "maps", though — see `basemapMembers`.
  const regionArtifacts = artifacts.filter(
    (a) => a.kind === "basemap-region" || a.kind === "dem-region",
  );

  // A region download in flight, as one card per run at the top of the Regions
  // filter. It is background work — the queue keeps running while the user is
  // anywhere in the app — so this screen watches it rather than owning it, the
  // same shape as the GeoPDF import card below. A run whose every job is saved
  // drops off: its artifacts are in the list underneath by then.
  const regionJobs = useRegionDownloads();
  const downloadGroups = groupRegionJobs(regionJobs).filter(
    (group) => !group.done,
  );

  // Half-written regions with NO job in the queue — a download the app was
  // killed during. The queue is memory only, so after a relaunch the file on
  // disk is the sole evidence it ever started (regionMbtiles.ts).
  //
  // This used to live in the map's layers sheet, which was a strange place to
  // look for it and, worse, opened every region file to do the scan — racing
  // the queue for the same SQLite lock and failing the very download it was
  // offering to resume. Recovery belongs beside the runs it recovers.
  const [orphans, setOrphans] = useState<UnfinishedRegion[]>([]);
  const queuedIds = regionJobs.map((job) => job.spec.id).join(",");
  const refreshOrphans = useCallback(() => {
    // The live ids go IN, rather than filtering the result: opening a file the
    // queue is writing is what cost a download its finalize.
    const live = new Set(queuedIds.split(","));
    listUnfinishedRegions(live)
      .then(setOrphans)
      .catch(console.error);
  }, [queuedIds]);
  useEffect(refreshOrphans, [refreshOrphans]);

  const resumeOrphan = useCallback(
    (region: UnfinishedRegion) => {
      enqueueRegionDownloads([
        {
          taskKind: "tile-pyramid",
          id: region.id,
          basemapId: region.basemapId,
          label: region.label,
          // The file remembers the run it belonged to, so a resume keeps the
          // name the user gave the area. Files written before that row existed
          // fall back to standing alone under their own label.
          groupId: region.groupId ?? region.id,
          groupLabel: region.groupLabel ?? region.label,
          bbox: region.bbox,
          // Both ends of the zoom range come off the file, so a resumed DEM
          // (one flat level) is re-planned as one flat level rather than as a
          // basemap pyramid — which would hash to a different plan and throw
          // the checkpoint's gap list away.
          zMin: region.zMin,
          zMax: region.zMax,
          allowCellular: false,
        },
      ]);
      setOrphans((current) => current.filter((row) => row.id !== region.id));
    },
    [],
  );

  const discardOrphan = useCallback((region: UnfinishedRegion) => {
    Alert.alert(
      "Discard this download?",
      "The tiles saved so far are deleted from this phone.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            void deleteRegionFile(region.id);
            setOrphans((current) => current.filter((row) => row.id !== region.id));
          },
        },
      ],
    );
  }, []);
  // Per-job detail (which basemap, pause/resume/stop, failure copy) lives in
  // the card's ⋯ sheet rather than expanded under it: four states' worth of
  // copy and up to three buttons per job is a panel, and unfolding it would
  // push the saved regions off the screen while the user watches.
  const [downloadSheetId, setDownloadSheetId] = useState<string | null>(null);
  const downloadSheetGroup =
    downloadGroups.find((group) => group.groupId === downloadSheetId) ?? null;
  const confirmStopGroup = useCallback(
    (group: { label: string; jobs: { spec: { id: string } }[] }) => {
      Alert.alert(
        "Stop saving these maps?",
        "The tiles saved so far are deleted from this phone.",
        [
          { text: "Keep going", style: "cancel" },
          {
            text: "Stop",
            style: "destructive",
            onPress: () => {
              for (const job of group.jobs) cancelRegionDownload(job.spec.id);
            },
          },
        ],
      );
    },
    [],
  );

  const overlaysQuery = useApiQuery(
    getCompletedOverlays,
    "Couldn't load topo overlays.",
    accountState !== "guest",
  );
  const mergedOverlays = mergeSavedOverlayJobs(overlaysQuery.data, artifacts);
  const savedOverlayArtifacts = artifacts.filter((a) => a.kind === "topo-overlay");
  // "Available to download" is one row per JOB, not per layer: a job's five
  // layers are one thing the user generated, and five near-identical rows with
  // five download buttons is a chore, not a choice. The per-layer
  // `downloadTopoOverlay` calls run underneath, in sequence.
  const downloadableJobs = mergedOverlays.jobs
    .map((job) => ({
      jobId: job.jobId,
      label: job.name ?? `Topo ${job.jobId.slice(0, 8)}`,
      // A synthetic job (built from what is on disk when the account list is
      // unreachable) carries no URL, so there is nothing to offer.
      missing: job.layers.filter(
        (layer) =>
          layer.pmtilesUrl !== "" &&
          !savedOverlayArtifacts.some(
            (a) => a.logicalKey === `${job.jobId}/${layer.name}`,
          ),
      ),
    }))
    .filter((job) => job.missing.length > 0);

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
  /** Save a whole topo job: its missing layers, one after another (the pipeline
   *  is exclusive), reported through the single activeOp row. */
  const handleSaveOverlayJob = useCallback(
    async (item: {
      jobId: string;
      label: string;
      missing: { name: TopoLayerName; format: TopoLayerFormat; pmtilesUrl: string }[];
    }) => {
      try {
        if (!(await confirmCellularOk())) return;
        setOverlayBusyKey(item.jobId);
        for (const [index, layer] of item.missing.entries()) {
          setActiveOp({
            label: `Saving ${item.label} — ${index + 1} of ${item.missing.length} layers`,
            category: "overlay",
            fraction: null,
          });
          await downloadTopoOverlay(
            {
              jobId: item.jobId,
              layer: layer.name,
              format: layer.format,
              pmtilesUrl: layer.pmtilesUrl,
            },
            (p) =>
              setActiveOp((current) =>
                current
                  ? { ...current, fraction: p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : null }
                  : current,
              ),
          );
        }
        info("Topo saved for offline use.");
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
  const waypoints = useMirrorWaypoints();
  const [waypointQuery, setWaypointQuery] = useState("");
  const [waypointTag, setWaypointTag] = useState<string | null>(null);
  const [coordSheetOpen, setCoordSheetOpen] = useState(false);

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

    // ONE card per saved AREA, not per basemap: a "Save maps offline" run
    // downloads a file per selected map and used to land as that many unrelated
    // rows, so deleting "the region" meant finding all of them. Legacy rows
    // (no groupId) group under their own id and stand alone, unchanged.
    for (const group of groupArtifacts(regionArtifacts, regionGroupKey)) {
      const first = group.members[0];
      // The DEM saved with the run is a member (its bytes and its deletion
      // belong to this card) but it is not a MAP: it is never drawn, never
      // switched to, and counting it would tell the user they saved three maps
      // when they picked two.
      const basemapMembers = group.members.filter((a) => a.kind !== "dem-region");
      rows.push({
        key: `region:${group.key}`,
        category: "region",
        title: group.label ?? "Offline map region",
        subtitle: `${countOf(basemapMembers.length, "map")} · saved ${formatDay(first.downloadedAt)}`,
        sizeBytes: group.sizeBytes,
        locatable: group.bbox != null,
        // Which basemap to switch the map to on "Show on map" — the first of
        // the area's maps; the others cover the same ground.
        focusBasemapId: basemapMembers[0]?.logicalKey as BasemapId | undefined,
        resolveBbox: async () => group.bbox,
        // A rename is the name of the AREA, so it reaches every row of the run.
        rename: (name) =>
          first.groupId
            ? renameArtifactGroup(first.groupId, name)
            : renameArtifact(first.id, name),
        members: group.members.map((artifact) => ({
          id: artifact.id,
          title: regionMemberName(artifact),
          sizeBytes: artifact.sizeBytes,
          delete: () => deleteDownloadedArtifact(artifact.id),
        })),
        delete: {
          confirmTitle: "Delete this region?",
          confirmBody: `The offline tiles for this area (${countOf(basemapMembers.length, "map")}) are removed from the device.`,
          run: async () => {
            for (const artifact of group.members) {
              await deleteDownloadedArtifact(artifact.id);
            }
          },
        },
      });
    }

    // Same treatment for a generated topo job: five layers, one job, one card.
    for (const group of groupArtifacts(savedOverlayArtifacts, overlayJobId)) {
      const job = mergedOverlays.jobs.find((candidate) => candidate.jobId === group.key);
      rows.push({
        key: `overlay:${group.key}`,
        category: "overlay",
        title: group.label ?? job?.name ?? `Topo ${group.key.slice(0, 8)}`,
        subtitle: countOf(group.members.length, "layer"),
        sizeBytes: group.sizeBytes,
        pill: { label: "Offline", tone: "accent" },
        locatable: group.bbox != null,
        resolveBbox: async () => group.bbox,
        // Topo artifacts carry no groupId (they are written a layer at a time
        // by the overlay downloader), so the group rename writes each row's
        // own display label. Display only, as everywhere else.
        rename: (name) =>
          Promise.all(group.members.map((artifact) => renameArtifact(artifact.id, name))),
        members: group.members.map((artifact) => ({
          id: artifact.id,
          title: topoLayerLabel(artifact.logicalKey),
          sizeBytes: artifact.sizeBytes,
          delete: () => deleteDownloadedArtifact(artifact.id),
        })),
        delete: {
          confirmTitle: "Delete this topo?",
          confirmBody: `Its ${countOf(group.members.length, "layer")} are removed from the device. You can download them again later.`,
          run: async () => {
            for (const artifact of group.members) {
              await deleteDownloadedArtifact(artifact.id);
            }
          },
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
        // No "GeoPDF ·" prefix and nothing restating the pill: the row's glyph
        // and hue say the kind, and "Unfinished" is already a pill.
        subtitle: failed
          ? (geoPdf.errorCode && GEOPDF_ERRORS[geoPdf.errorCode]) || "Import failed."
          : incomplete
            ? undefined
            : `Imported ${formatDay(geoPdf.createdAt)}`,
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

    for (const waypoint of waypoints.data ?? []) {
      const shared = waypoint.syncRole === "shared";
      rows.push({
        key: waypoint.id,
        category: "waypoint",
        title: waypoint.name,
        // Tags and provenance ONLY — never the coordinate. This is a list
        // surface, and the position lives one tap away on the detail sheet
        // (DESIGN.md 11).
        subtitle: waypoint.tags.length
          ? waypoint.tags.join(" · ")
          : shared
            ? "shared with you"
            : `marked ${formatDay(waypoint.createdAt)}`,
        // A synced row, not a file on this device — same treatment as routes
        // and recordings, so it stays out of the capacity meter.
        sizeBytes: 0,
        ...(shared ? { pill: { label: "Shared", tone: "muted" as const } } : {}),
        // Notes are searchable but never rendered in the row — a note can hold
        // anything, and this is a list surface.
        search: {
          haystack: `${waypoint.name} ${waypoint.notes ?? ""} ${waypoint.tags.join(" ")}`.toLowerCase(),
          tags: waypoint.tags,
        },
        ...waypointActions(waypoint),
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
    waypoints.data,
    geoPdfImports,
    handleResumeGeoPdf,
    imports,
    mergedOverlays,
    savedOverlayArtifacts,
    regionArtifacts,
    savedTracks,
  ]);

  const counts = useMemo(() => {
    const byCategory = {
      region: 0,
      overlay: 0,
      geoPdf: 0,
      route: 0,
      waypoint: 0,
      vector: 0,
      track: 0,
    };
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

  /**
   * What the empty state of the current tab offers to do about it.
   *
   * `null` where the tab IS the action: the LiDAR tab lists the account's
   * overlays to save right above this panel, so a button that re-opens the tab
   * you are standing on would be an affordance that only refuses (DESIGN.md
   * §7).
   */
  const emptyAction = ((): { label: string; onPress: () => void } | null => {
    switch (filter) {
      case "all":
        return { label: "Add to device", onPress: () => setAddSheetOpen(true) };
      case "region":
        return online ? { label: "Download a region", onPress: onDownloadRegion } : null;
      case "overlay":
        return null;
      case "geoPdf":
        return { label: "Import a GeoPDF", onPress: handleImportGeoPdf };
      case "waypoint":
        return { label: "Add a waypoint", onPress: () => setCoordSheetOpen(true) };
      case "track":
        return { label: "Record a track", onPress: onRecordTrack };
      case "route":
        return { label: "Draw a route", onPress: onDrawRoute };
      case "vector":
        return importBusy
          ? null
          : { label: "Import a file", onPress: () => void handleImportFile() };
    }
  })();

  // "All" is size-descending — the order that answers "what is filling the
  // device". Within a category, insertion order (newest registry rows last)
  // is more useful than size.
  // The tag rail is the vocabulary IN USE, so it shrinks as waypoints are
  // deleted and never offers a tag that would match nothing.
  const waypointTagOptions = useMemo<SegmentOption<string>[]>(() => {
    const tally = new Map<string, number>();
    for (const item of items) {
      if (item.category !== "waypoint") continue;
      for (const tag of item.search?.tags ?? []) {
        tally.set(tag, (tally.get(tag) ?? 0) + 1);
      }
    }
    if (tally.size === 0) return [];
    return [
      { value: "all", label: "All tags" },
      ...[...tally.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({
          value: tag,
          label: tag,
          count,
          hue: assetHue.waypoint,
        })),
    ];
  }, [items]);

  const inCategory =
    filter === "all"
      ? [...items].sort((a, b) => b.sizeBytes - a.sizeBytes)
      : items.filter((item) => item.category === filter);

  // Narrowing only ever applies inside the waypoint filter, so leaving a stale
  // query behind cannot silently hide another category's rows.
  const needle = waypointQuery.trim().toLowerCase();
  const visibleItems =
    filter === "waypoint"
      ? inCategory.filter(
          (item) =>
            (!needle || (item.search?.haystack ?? "").includes(needle)) &&
            (!waypointTag || (item.search?.tags ?? []).includes(waypointTag)),
        )
      : inCategory;

  const closeCoordSheet = useCallback(() => {
    setCoordSheetOpen(false);
    setWaypointDraft(null);
    setPickedCoords(null);
  }, []);

  /**
   * Off to the map picker, from whichever waypoint form asked.
   *
   * The form's own fields come up with the request, because the sheet is a
   * Modal that has to close for a full-screen map to be visible — the draft is
   * what makes the round trip lossless, and a cancelled pick restores it just
   * the same: they went to look at a map, not to throw away what they typed.
   */
  const openWaypointPicker = useCallback(
    (
      form: "create" | "edit",
      current: WaypointFormDraft,
      /** Only the edit form has one — a waypoint that does not exist yet has
       *  no pin to hide. */
      hideWaypointId?: string,
    ) => {
      // EMPTY IS NOT ZERO. `Number("")` is 0, and 0/0 is a valid coordinate —
      // so testing the parsed value alone opened the picker on null island with
      // a marker already placed, which reads as "the app thinks the waypoint is
      // there".
      const latitude = Number(current.latitude.trim());
      const longitude = Number(current.longitude.trim());
      const from =
        current.latitude.trim() !== "" &&
        current.longitude.trim() !== "" &&
        isValidLatitude(latitude) &&
        isValidLongitude(longitude)
          ? { latitude, longitude }
          : null;
      setWaypointDraft(current);
      setPickedCoords(null);
      setPickerAway(form);
      if (form === "create") setCoordSheetOpen(false);
      onPickPoint(from, hideWaypointId);
    },
    [onPickPoint],
  );

  /** Create, from the form's own validated fields. */
  const createWaypoint = useCallback(
    (fields: WaypointFormFields) => {
      // The form validates with the API's own predicates before it calls this,
      // so a missing core field here is impossible rather than handled — the
      // guard is what makes that statement checkable.
      if (fields.name == null || fields.latitude == null || fields.longitude == null) {
        return;
      }
      createWaypointLocal({
        name: fields.name,
        latitude: fields.latitude,
        longitude: fields.longitude,
        notes: fields.notes ?? null,
      })
        .then(() => {
          info(`Saved “${fields.name ?? ""}”.`);
          closeCoordSheet();
        })
        .catch((err: unknown) => {
          console.error(err);
          fail(messageFromError(err, "Couldn't save that waypoint."));
        });
    },
    [closeCoordSheet, fail, info],
  );

  // Everything picked that is still in the list, in list order.
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedKeys.includes(item.key)),
    [selectedKeys, visibleItems],
  );
  const selecting = selectedItems.length > 0;
  const selectedBytes = selectedItems.reduce((sum, item) => sum + item.sizeBytes, 0);
  const selectableItems = visibleItems.filter((item) => item.delete);

  /** One confirm for the whole batch; the sentence itself is
   *  `bulkDeleteConfirmBody`, which owns every count/kind combination. */
  const deleteSelected = useCallback(() => {
    const targets = selectedItems;
    const syncedCount = targets.filter(
      (item) => item.category === "route" || item.category === "waypoint",
    ).length;
    const body = bulkDeleteConfirmBody({
      onDeviceCount: targets.length - syncedCount,
      syncedCount,
      onDeviceBytes: selectedBytes,
    });
    Alert.alert(`Delete ${countOf(targets.length, "item")}?`, body, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            // Sequential, and a failure does not abandon the rest: these are
            // independent deletes and stopping at the first one leaves the user
            // guessing which half happened.
            let failures = 0;
            // An item with no delete descriptor cannot be selected in the
            // first place; filtering rather than asserting keeps that true by
            // construction if the selection rule ever changes.
            const removals = targets.flatMap((item) => item.delete ?? []);
            for (const removal of removals) {
              try {
                await removal.run();
              } catch (err) {
                console.error(err);
                failures += 1;
              }
            }
            clearSelection();
            refreshFreeSpace();
            if (failures === 0) info(`Deleted ${countOf(targets.length, "item")}.`);
            else fail(`${failures} of ${targets.length} couldn't be deleted.`);
          })();
        },
      },
    ]);
  }, [clearSelection, fail, info, refreshFreeSpace, selectedBytes, selectedItems]);

  const deleteItem = useCallback(
    (item: SavedItem) => {
      const removal = item.delete;
      if (!removal) return;
      Alert.alert(removal.confirmTitle, removal.confirmBody, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            removal
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

  /** Delete ONE file out of a grouped card (a basemap, a topo layer). */
  const deleteMember = useCallback(
    (member: { title: string; delete: () => Promise<unknown> }) => {
      Alert.alert(
        `Delete ${member.title}?`,
        "This map is removed from the device. The rest of this one stays.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              member
                .delete()
                .then(refreshFreeSpace)
                .catch((err: unknown) => {
                  console.error(err);
                  fail(messageFromError(err, "Couldn't delete that."));
                });
            },
          },
        ],
      );
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
          onOpenMap(bbox, item.focusBasemapId, { category: item.category, key: item.key });
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
  // A waypoint's overflow offers the same verbs its map sheet does — the bodies
  // are shared (waypoints/waypointSheetBodies.tsx) so the two cannot drift.
  const menuWaypoint =
    menuItem?.category === "waypoint"
      ? ((waypoints.data ?? []).find((row) => row.id === menuItem.key) ?? null)
      : null;
  // A recorded track and an imported line both answer the same question — what
  // IS this — with the same panel the map shows (DESIGN.md §7). The import's
  // series is read out of its stored GeoJSON; the track's out of SQLite.
  const menuTrack =
    menuItem?.category === "track"
      ? (savedTracks.find((track) => track.id === menuItem.key) ?? null)
      : null;
  const menuImport =
    menuItem?.category === "vector"
      ? (imports.find((imported) => imported.id === menuItem.key) ?? null)
      : null;
  const statsOpen = menuMode === "stats";
  const trackStats = useTrackDetail(
    menuTrack?.id ?? null,
    statsOpen,
    menuTrack?.durationMs,
  );
  const importStats = useImportedTrackDetail(menuImport, statsOpen);
  // Heights from the terrain, for whichever of the two is open. Saved has no
  // offline-only switch of its own (that is a property of the MAP), so the
  // hook's normal source order applies: saved tiles, then our API, then the
  // public ones.
  const statsElevation = useElevationProfile(
    menuImport ? importStats.line : trackStats.line,
  );

  const writeMenuWaypoint = (fields: Record<string, unknown>) => {
    if (!menuWaypoint) return;
    updateWaypointLocal(menuWaypoint.id, fields).catch((err: unknown) => {
      console.error(err);
      fail(messageFromError(err, "Couldn't save that change."));
    });
  };
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

      {/* While picking, the contextual bar TAKES the rail's slot rather than
          stacking a second bar over the tab bar: two rows of chrome above the
          thumb, and the tabs are the escape hatch out of the mode. Changing
          category mid-selection is impossible for the same reason it is
          cleared on a handoff — see selectFilter. */}
      {selecting ? (
        <View style={[styles.rail, styles.selectionBar]}>
          <IconButton
            icon="x"
            accessibilityLabel="Clear selection"
            onPress={clearSelection}
          />
          <Text style={styles.selectionCount} numberOfLines={1}>
            {countOf(selectedItems.length, "item")} selected
            {selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ""}
          </Text>
          {/* "Everything" means everything a selection can act on — a shared
              route or waypoint is skipped rather than picked and then refused. */}
          {selectedItems.length < selectableItems.length ? (
            <IconButton
              icon="check-square"
              accessibilityLabel="Select everything in this list"
              onPress={() => setSelectedKeys(selectableItems.map((item) => item.key))}
            />
          ) : null}
          <IconButton
            icon="trash-2"
            accessibilityLabel="Delete the selected items"
            color={theme.warning}
            filled
            onPress={deleteSelected}
          />
        </View>
      ) : (
      <View style={styles.rail}>
        <SegmentedControl
          options={filterOptions}
          value={filter}
          onChange={selectFilter}
          scroll
        />
        {/* Search + tag chips belong to the WAYPOINT filter only. Every other
            category here is a handful of large files you scan by eye; a
            waypoint list is hundreds of small things you came looking for one
            of. Both narrow the mirror on this device — no request, so it works
            in a gorge. */}
        {filter === "waypoint" ? (
          <>
            {/* Nothing to search: the field is hidden with nothing on the
                phone, same rule the tag rail already follows, and the empty
                panel gets the whole screen body. */}
            {counts.waypoint > 0 ? (
              // The field carries its own right pad because the rail has none —
              // the category chips are meant to scroll off the edge, an input
              // running into it just looks clipped.
              <View style={styles.waypointSearch}>
                <TextField
                  label="Search waypoints"
                  value={waypointQuery}
                  onChangeText={setWaypointQuery}
                />
              </View>
            ) : null}
            {waypointTagOptions.length > 0 ? (
              <View style={styles.waypointTags}>
                <SegmentedControl
                  options={waypointTagOptions}
                  value={waypointTag ?? "all"}
                  onChange={(value) =>
                    setWaypointTag(value === "all" ? null : value)
                  }
                  scroll
                />
              </View>
            ) : null}
          </>
        ) : null}
      </View>
      )}

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
            subtitle={[
              GEOPDF_PHASE_LABEL[importRun.phase],
              importRun.fraction != null
                ? `${Math.round(importRun.fraction * 100)}%`
                : null,
              // What the run is going to cost, as soon as planning knows —
              // a GeoPDF import is minutes of rendering and used to quote no
              // number at all before starting them.
              importRun.estimate
                ? `${importRun.estimate.tiles.toLocaleString()} tiles · ${formatMinutes(importRun.estimate.seconds)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
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

        {/* Downloading regions, one card per run, at the top of the Regions
            filter and nowhere else — "All" is an inventory of what is actually
            on the device, and these are not there yet. Same rule the GeoPDF
            import card follows. */}
        {filter === "region" && downloadGroups.length > 0 ? (
          <>
            {downloadGroups.map((group) => (
              <Row
                key={group.groupId}
                title={group.label || "Saving maps"}
                subtitle={
                  group.settled
                    ? `${countOf(group.unfinished, "map")} didn't finish`
                    : `${group.ready} of ${countOf(group.mapCount, "map")} saved`
                }
                icon="download-cloud"
                hue={group.settled ? theme.warning : assetHue.region}
                progress={group.fraction}
                right={
                  <View style={styles.rowActions}>
                    <IconButton
                      icon="x"
                      accessibilityLabel="Stop saving these maps"
                      onPress={() => confirmStopGroup(group)}
                    />
                    <IconButton
                      icon="more-vertical"
                      accessibilityLabel={`Maps in ${group.label || "this download"}`}
                      onPress={() => setDownloadSheetId(group.groupId)}
                    />
                  </View>
                }
              />
            ))}
            <Text style={styles.downloadNote}>
              Downloads only run while Logjam is open.
            </Text>
          </>
        ) : null}

        {filter === "region" && orphans.length > 0 ? (
          <>
            {orphans.map((region) => (
              <Row
                key={region.id}
                title={region.groupLabel ?? region.label}
                subtitle={`Didn't finish · ${region.tilesStored.toLocaleString()} tiles already saved`}
                icon="download-cloud"
                hue={theme.warning}
                right={
                  <View style={styles.rowActions}>
                    <Button
                      label="Resume"
                      variant="outlineAccent"
                      compact
                      onPress={() => resumeOrphan(region)}
                    />
                    <IconButton
                      icon="trash-2"
                      color={theme.warning}
                      accessibilityLabel={`Discard the unfinished download ${region.label}`}
                      onPress={() => discardOrphan(region)}
                    />
                  </View>
                }
              />
            ))}
          </>
        ) : null}

        {visibleItems.length === 0 &&
        !activeOp &&
        !importRun &&
        (filter !== "region" || downloadGroups.length === 0) ? (
          <EmptyPanel
            filter={filter}
            online={online}
            // The action that fills THIS tab, not the menu of everything —
            // an empty GeoPDF tab knows exactly which flow it is missing, and
            // making the user pick it out of a list again is a step that
            // answers a question they already answered by being here.
            action={emptyAction}
          />
        ) : null}

        {visibleItems.map((item) => {
          const picked = selectedKeys.includes(item.key);
          return (
          <Row
            key={item.key}
            title={item.title}
            subtitle={item.subtitle}
            icon={CATEGORY_META[item.category].icon}
            hue={assetHue[item.category]}
            selected={picked}
            // While selecting, an asset this user may not delete (a shared
            // route or waypoint) is greyed out — the same dead look an
            // account-gated row gets — rather than offered and then refused.
            disabled={selecting && !item.delete}
            // Press and hold starts a selection anywhere; once one is running a
            // plain tap toggles. Outside the mode a row still has no onPress —
            // its verbs live in the ⋯ sheet, and a whole-row tap that did one
            // of them would be a mis-tap waiting to happen (DESIGN.md §7).
            onLongPress={() => selectItem(item)}
            onPress={selecting ? () => selectItem(item) : undefined}
            right={
              selecting ? (
                <View style={styles.rowActions}>
                  {item.sizeBytes > 0 ? (
                    <Text style={styles.size}>{formatBytes(item.sizeBytes)}</Text>
                  ) : null}
                  {/* No circle at all on a row that cannot be picked: an
                      empty checkbox is a promise that tapping it does
                      something. */}
                  {item.delete ? (
                    <Feather
                      name={picked ? "check-circle" : "circle"}
                      size={22}
                      color={picked ? theme.accent : theme.textMuted}
                    />
                  ) : null}
                </View>
              ) : (
              <View style={styles.rowActions}>
                {item.sizeBytes > 0 ? (
                  <Text style={styles.size}>{formatBytes(item.sizeBytes)}</Text>
                ) : null}
                {/* The pill is wrapped because its own base style carries
                    `alignSelf: "flex-start"` — right in the COLUMN contexts it
                    is used in elsewhere (the hero notes, a detail header),
                    where it stops the pill stretching the full width, but in
                    this row-direction container flex-start is the TOP edge and
                    the pill floated above the size text beside it. The wrapper
                    takes the container's `alignItems: center` and the pill
                    aligns inside it. */}
                {item.pill ? (
                  <View>
                    <StatusPill label={item.pill.label} tone={item.pill.tone} />
                  </View>
                ) : null}
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
              )
            }
          />
          );
        })}

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
        {filter === "overlay" && downloadableJobs.length > 0 ? (
          <>
            <SectionHeader label="Available to download" />
            {downloadableJobs.map((job) => (
              <Row
                key={job.jobId}
                title={job.label}
                // "Not on this device" restated the section header it sits
                // under; the layer count does not.
                subtitle={
                  lidarReady
                    ? countOf(job.missing.length, "layer")
                    : "Connect to download"
                }
                icon="layers"
                hue={assetHue.overlay}
                right={
                  <IconButton
                    icon="download"
                    accessibilityLabel={`Save ${job.label} for offline use`}
                    color={theme.accent}
                    disabled={!lidarReady || overlayBusyKey != null}
                    onPress={() => handleSaveOverlayJob(job)}
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
                  job.resultBytes != null ? formatBytes(job.resultBytes) : undefined
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

      {/* A waypoint you did not stand on: read off a printed guide, a trip
          report, someone's message. The map's press-and-hold cannot express a
          coordinate you were given rather than found. */}
      <BottomSheet
        visible={coordSheetOpen}
        onClose={closeCoordSheet}
        title="Create waypoint"
      >
        <View style={styles.sheetBody}>
          {/* The same body the edit forms use — one definition of what a
              waypoint has, so creating one can never offer fewer fields than
              fixing one (DESIGN.md §7). */}
          <WaypointFormBody
            draft={waypointDraft}
            picked={pickedCoords}
            onPickOnMap={(current) => openWaypointPicker("create", current)}
            submitLabel="Save waypoint"
            onSubmit={createWaypoint}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title="Add to this device"
      >
        {/* NO SUBTITLES. Every row here names a verb and an object — "Import a
            GeoPDF file" — and a second line explaining that a file comes from
            this phone's storage is a sentence nobody needed twice. Order is
            the filter rail's (CATEGORY_ORDER), with each kind's own-device
            source above its account one. */}
        <View style={styles.sheetBody}>
          <Row
            title="Download a map region"
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
            icon="file-text"
            hue={assetHue.geoPdf}
            onPress={() => {
              setAddSheetOpen(false);
              handleImportGeoPdf();
            }}
          />
          <Row
            title={accountJobsLoading ? "Loading your GeoPDFs…" : "GeoPDFs from my account"}
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
          {/* Under the other "from my account" row rather than up with the
              regions: both are things you generated on the web and are pulling
              down, which is more like each other than either is like a
              basemap download. */}
          <Row
            title="LiDAR topos from my account"
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
          <Row
            title="Create a waypoint"
            icon="map-pin"
            hue={assetHue.waypoint}
            onPress={() => {
              setAddSheetOpen(false);
              setCoordSheetOpen(true);
            }}
          />
          {/* The two that are not "add a file" but "go and make one". They live
              here because this sheet is the answer to "how do I get something
              onto this device", and a user who has never drawn a route has no
              reason to know the pen lives on the map. Both hand over to the
              map: arming either needs the location prompt, which cannot be
              raised from an open sheet (DESIGN.md §7). */}
          <Row
            title="Record a track"
            icon="activity"
            hue={assetHue.track}
            onPress={() => {
              setAddSheetOpen(false);
              onRecordTrack();
            }}
          />
          <Row
            title="Draw a route"
            icon="edit-3"
            hue={assetHue.route}
            onPress={() => {
              setAddSheetOpen(false);
              onDrawRoute();
            }}
          />
          <Row
            title="Import GPX, KML or GeoJSON"
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
        </View>
      </BottomSheet>

      <BottomSheet
        visible={menuItem != null && !showRouteSheet && pickerAway == null}
        onClose={closeItemSheet}
        title={
          menuItem == null
            ? ""
            : menuMode === "rename"
              ? menuWaypoint
                ? "Edit waypoint"
                : `Rename ${CATEGORY_META[menuItem.category].label.toLowerCase()}`
              : menuMode === "tags"
                ? "Tags"
                : menuMode === "canyons"
                  ? "Linked canyons"
                  : menuItem.title
        }
        // Only the waypoint sub-modes go BACK to an actions list; every other
        // mode here (a plain rename) closes instead.
        onBack={
          (menuWaypoint && (menuMode === "tags" || menuMode === "canyons")) ||
          menuMode === "stats"
            ? () => setMenuMode("actions")
            : undefined
        }
        header={
          menuWaypoint && menuMode === "canyons" ? (
            <WaypointSubModeHeader hint="Anyone you share a canyon with can see its waypoints.">
              <WaypointCanyonFilter
                value={menuCanyonQuery}
                onChangeText={setMenuCanyonQuery}
              />
            </WaypointSubModeHeader>
          ) : undefined
        }
      >
        <View style={styles.sheetBody}>
          {menuItem == null ? null : menuMode === "rename" ? (
            // A waypoint gets the full editor — name, POSITION and notes — the
            // same body the map's own sheet uses, because a waypoint reached
            // from Saved must not be a lesser object than one reached from the
            // map (DESIGN.md §7). Everything else here is a name-only rename.
            menuWaypoint ? (
              <WaypointFormBody
                waypoint={menuWaypoint}
                draft={waypointDraft}
                picked={pickedCoords}
                onPickOnMap={(current) =>
                  openWaypointPicker("edit", current, menuWaypoint.id)
                }
                onSubmit={(changed) => {
                  if (Object.keys(changed).length > 0) writeMenuWaypoint(changed);
                  closeItemSheet();
                }}
              />
            ) : (
              <RenameForm
                initialName={menuItem.title}
                onSubmit={(changed) => {
                  const target = menuItem;
                  if (changed.name && target.rename) {
                    target.rename(changed.name).catch((err: unknown) => {
                      console.error(err);
                      fail(messageFromError(err, "Couldn't rename that."));
                    });
                  }
                  closeItemSheet();
                }}
              />
            )
          ) : menuMode === "stats" ? (
            menuImport ? (
              <TrackStatsBody
                detail={importStats.detail}
                loading={importStats.loading}
                demProfile={statsElevation.profile}
                demLoading={statsElevation.loading}
                emptyMessage={
                  importStats.error ??
                  "No lines in this file — stats describe a walked line."
                }
              />
            ) : (
              // A finished track's time is the stored wall-clock span minus
              // pauses, not the span between its first and last fix.
              <TrackStatsBody
                detail={trackStats.detail}
                loading={trackStats.loading}
                elapsedMs={menuTrack?.durationMs}
                demProfile={statsElevation.profile}
                demLoading={statsElevation.loading}
              />
            )
          ) : menuMode === "tags" && menuWaypoint ? (
            <WaypointTagsBody
              waypoint={menuWaypoint}
              allWaypoints={waypoints.data ?? []}
              onWrite={writeMenuWaypoint}
            />
          ) : menuMode === "canyons" && menuWaypoint ? (
            <WaypointCanyonsBody
              waypoint={menuWaypoint}
              query={menuCanyonQuery}
              onWrite={writeMenuWaypoint}
            />
          ) : (
            <>
              {/* Says why the write verbs below are missing, in the same words
                  the map's waypoint sheet uses. */}
              {menuItem.delete ? null : (
                <Text style={styles.sharedHint}>{SHARED_READ_ONLY_HINT}</Text>
              )}
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
              {/* Only for the two categories that ARE a line someone walked.
                  A region, a GeoPDF or a waypoint has no distance to report. */}
              {menuTrack || menuImport ? (
                <Row
                  title="Stats"
                  subtitle="Distance, climb, pace and profiles"
                  icon="bar-chart-2"
                  hue={assetHue[menuItem.category]}
                  onPress={() => setMenuMode("stats")}
                />
              ) : null}
              {/* A finished recording can be picked back up — the same verb the
                  map's own track sheet offers, so a track reached from here is
                  not a lesser object than one reached from the line
                  (DESIGN.md §7). It leaves for the map, which is where a
                  recording lives. */}
              {menuTrack ? (
                <Row
                  title="Continue recording"
                  icon="play-circle"
                  hue={assetHue.track}
                  onPress={() => {
                    const trackId = menuTrack.id;
                    closeItemSheet();
                    onContinueRecording(trackId);
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
              {/* Absent on a shared route or waypoint: the rename used to be
                  offered, take the user's typing and drop it (the descriptor's
                  stub resolved without writing anything). */}
              {menuItem.rename ? (
                <Row
                  title={menuWaypoint ? "Edit" : "Rename"}
                  icon="edit-2"
                  hue={theme.bonus1}
                  onPress={() => setMenuMode("rename")}
                />
              ) : null}
              {/* The same two verbs the waypoint's map sheet offers, rendering
                  the same bodies — a waypoint reached from Saved must not be a
                  lesser object than one reached from the map (DESIGN.md §7). */}
              {menuWaypoint && menuWaypoint.syncRole !== "shared" ? (
                <>
                  <Row
                    title="Tags"
                    subtitle={
                      menuWaypoint.tags.length
                        ? menuWaypoint.tags.join(", ")
                        : "None yet"
                    }
                    icon="tag"
                    hue={assetHue.track}
                    onPress={() => setMenuMode("tags")}
                  />
                  <Row
                    title="Linked canyons"
                    subtitle={
                      menuWaypoint.canyonIds.length
                        ? `${menuWaypoint.canyonIds.length} linked`
                        : "Not linked"
                    }
                    icon="link-2"
                    hue={assetHue.route}
                    onPress={() => setMenuMode("canyons")}
                  />
                </>
              ) : null}
              {/* Every asset that reaches THIS sheet is a file on this
                  handset. A route is not — it is a synced record whose delete
                  removes it from the account — which is why routes get their
                  own sheet rather than this label with a branch in it.
                  No descriptor = not this user's to delete (a shared
                  waypoint): the verb is absent rather than shown and refused,
                  and the hint above says why. */}
              {menuItem.delete ? (
                <Row
                  title={
                    menuWaypoint
                      ? "Delete waypoint"
                      : menuItem.members && menuItem.members.length > 1
                        ? "Delete all from device"
                        : "Delete from device"
                  }
                  icon="trash-2"
                  hue={theme.warning}
                  onPress={() => {
                    const target = menuItem;
                    closeItemSheet();
                    deleteItem(target);
                  }}
                />
              ) : null}
              {/* What this card is actually made of — the area's basemaps, the
                  topo job's layers — each with its own size and its own
                  delete, so one map can go without losing the rest. */}
              {menuItem.members && menuItem.members.length > 1 ? (
                <>
                  <SectionHeader label="Includes" />
                  {menuItem.members.map((member) => (
                    <Row
                      key={member.id}
                      title={member.title}
                      icon={CATEGORY_META[menuItem.category].icon}
                      hue={assetHue[menuItem.category]}
                      right={
                        <View style={styles.rowActions}>
                          <Text style={styles.size}>{formatBytes(member.sizeBytes)}</Text>
                          <IconButton
                            icon="trash-2"
                            accessibilityLabel={`Delete ${member.title} from device`}
                            color={theme.warning}
                            onPress={() => {
                              closeItemSheet();
                              deleteMember(member);
                            }}
                          />
                        </View>
                      }
                    />
                  ))}
                </>
              ) : null}
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

      {/* The run's jobs, one row each: which basemap, how far in, and
          pause/resume/stop. Kept behind the card's ⋯ rather than expanded
          under it — see the comment on `downloadSheetId`. */}
      <BottomSheet
        visible={downloadSheetGroup != null}
        onClose={() => setDownloadSheetId(null)}
        title={downloadSheetGroup?.label || "Saving maps"}
      >
        <View style={styles.sheetBody}>
          {downloadSheetGroup?.jobs.map((job) => (
            <RegionDownloadRow key={job.spec.id} job={job} />
          ))}
          <Text style={styles.downloadNote}>
            Downloads only run while Logjam is open.
          </Text>
        </View>
      </BottomSheet>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

// Per-filter empty states: each one names the thing that is missing and offers
// the action that fixes it, rather than a shared grey "nothing here".
function EmptyPanel({
  filter,
  online,
  action,
}: {
  filter: Category | "all";
  online: boolean;
  /** The one thing that fills this tab, or null where the tab is already it. */
  action: { label: string; onPress: () => void } | null;
}) {
  // An empty panel is where someone works out whether a feature is missing or
  // merely unused — so for the two account-backed categories it must say which.
  const isGuest = useAccountState().accountState === "guest";
  const copy: Record<Category | "all", { title: string; hint: string }> = {
    route: {
      title: "No routes yet",
      hint: "Draw one on the map with the pen tool — the approach, the creek, the exit.",
    },
    waypoint: {
      title: "No waypoints yet",
      hint: "Press and hold anywhere on the map to mark a spot — the carpark, the exit, a good campsite.",
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
      {action ? (
        <Button label={action.label} icon="plus" compact onPress={action.onPress} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.primary },
  // The rail's own bottom pad is the gap the list scrolls against — without it
  // rows slide flush into the chips.
  coordError: { color: theme.warning, fontSize: fontSize.sm },
  // Breathing room on both seams: category chips → search label, and search
  // input → tag chips. Without it the three controls read as one dense block.
  waypointSearch: { paddingTop: spacing(1.5), paddingRight: spacing(2) },
  waypointTags: { paddingTop: spacing(1.5) },
  rail: { paddingLeft: spacing(2), paddingTop: spacing(1.5), paddingBottom: spacing(1.5) },
  // Same vertical metrics as the rail it replaces, so nothing below it jumps
  // when a selection starts.
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.5),
    paddingLeft: spacing(0.5),
    paddingRight: spacing(1.5),
  },
  selectionCount: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  body: { paddingHorizontal: spacing(2), paddingBottom: spacing(4), gap: spacing(1) },
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  size: { color: theme.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  sheetBody: { gap: spacing(1) },
  // Same treatment as the map's waypoint sheet hint: a footnote above the
  // verbs, not a warning.
  sharedHint: { color: theme.textMuted, fontSize: fontSize.xs },
  // Small and honest: the constraint is real, but it is a footnote to the
  // cards above it, not a warning banner.
  downloadNote: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    paddingHorizontal: spacing(0.5),
  },
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
