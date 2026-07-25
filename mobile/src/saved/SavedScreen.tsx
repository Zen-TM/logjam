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
  messageFromError,
  type TopoLayerFormat,
  type TopoLayerName,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { getGeoPdfJob, listGeoPdfJobs, type GeoPdfJobView } from "../api/geoPdfJobs";
import { useApiQuery } from "../api/queries";
import { usePendingSyncCount } from "../sync/useSyncQueries";
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
  TextField,
  Toast,
  type CapacitySegment,
  type SegmentOption,
  type ToastMessage,
} from "../ui";
import {
  GEOPDF_ERRORS,
  deleteGeoPdfImport,
  importGeoPdfFromPicker,
  importGeoPdfFromUrl,
  resumeGeoPdfImport,
  type GeoPdfCancelToken,
  type GeoPdfProgress,
} from "../geopdf/importPipeline";
import { updateGeoPdfImport } from "../geopdf/geoPdfImportsDb";
import { useGeoPdfImports } from "../geopdf/useGeoPdfImports";
import { renameVectorImport } from "../imports/importsDb";
import { deleteVectorImport, importVectorFileFromPicker } from "../imports/vectorImports";
import { useVectorImports } from "../imports/useVectorImports";
import { useConnectivity } from "../map/connectivity";
import { mergeSavedOverlayJobs, type CompletedOverlaysResponse } from "../map/topoOverlays";
import { downloadTopoOverlay } from "../offline/overlayDownloads";
import { deleteDownloadedArtifact } from "../offline/regionDownloads";
import { renameArtifact } from "../offline/registryDb";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { deleteTrack, listTrackPoints, updateTrack } from "../tracks/tracksDb";
import { bboxOfPoints } from "./bboxOfPoints";
import { useTracks } from "../tracks/useTracks";
import type { Bbox } from "./bboxOfPoints";

function getCompletedOverlays(): Promise<CompletedOverlaysResponse> {
  return apiFetch<CompletedOverlaysResponse>("/topo-jobs/completed-overlays");
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// --- Category model -------------------------------------------------------
// One entry per asset kind: the filter rail, the capacity meter and every
// row's glyph/hue all read from here, so a new asset kind is one addition.
type Category = "region" | "overlay" | "geoPdf" | "vector" | "track";

const CATEGORY_META: Record<
  Category,
  { label: string; plural: string; icon: "map" | "layers" | "file-text" | "file-plus" | "activity" }
> = {
  region: { label: "Region", plural: "Regions", icon: "map" },
  overlay: { label: "LiDAR topo", plural: "LiDAR Topos", icon: "layers" },
  geoPdf: { label: "GeoPDF", plural: "GeoPDFs", icon: "file-text" },
  // "Files" was too vague (everything here is a file); the category is
  // specifically vector data brought in from another app, so it is named for
  // the formats users recognise.
  vector: { label: "GPX / KML", plural: "GPX & KML", icon: "file-plus" },
  track: { label: "Track", plural: "Tracks", icon: "activity" },
};

const CATEGORY_ORDER: Category[] = ["region", "overlay", "geoPdf", "vector", "track"];

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
  /** Resolved on tap — a track's extent needs its points read back. */
  resolveBbox: () => Promise<Bbox | null>;
  /** Persist a new display name. Every kind supports this. */
  rename: (name: string) => Promise<unknown>;
  delete: { confirmTitle: string; confirmBody: string; run: () => Promise<unknown> };
};

export function SavedScreen({ onOpenMap }: { onOpenMap: (bbox?: Bbox) => void }) {
  const connectivity = useConnectivity();
  const online = connectivity === "online";
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
  const [filter, setFilter] = useState<Category | "all">("all");
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
  // carries label, progress and cancel for whichever is running.
  const [activeOp, setActiveOp] = useState<{
    label: string;
    category: Category;
    fraction: number | null;
    cancellable: boolean;
  } | null>(null);

  // --- Downloaded regions + topo overlays (registry-backed) ---
  const { artifacts } = useMapArtifacts();
  const regionArtifacts = artifacts.filter((a) => a.kind === "basemap-region");

  const overlaysQuery = useApiQuery(getCompletedOverlays, "Couldn't load topo overlays.");
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
          cancellable: false,
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
        cancellable: false,
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
  const [geoPdfBusy, setGeoPdfBusy] = useState(false);
  const geoPdfCancel = useRef<GeoPdfCancelToken | null>(null);

  const geoPdfProgress = useCallback((progress: GeoPdfProgress) => {
    const measurable = progress.phase === "rasterising" || progress.phase === "overviews";
    setActiveOp((current) =>
      current ? { ...current, fraction: measurable ? progress.fraction : null } : current,
    );
  }, []);

  const startGeoPdfOp = useCallback((label: string): GeoPdfCancelToken => {
    setGeoPdfBusy(true);
    const token: GeoPdfCancelToken = { cancelled: false };
    geoPdfCancel.current = token;
    setActiveOp({ label, category: "geoPdf", fraction: null, cancellable: true });
    return token;
  }, []);

  const endGeoPdfOp = useCallback(() => {
    setGeoPdfBusy(false);
    setActiveOp(null);
    geoPdfCancel.current = null;
  }, []);

  const finishGeoPdf = useCallback(
    (outcome: Awaited<ReturnType<typeof importGeoPdfFromPicker>>) => {
      if (outcome.status === "imported") {
        info("GeoPDF imported.");
        setFilter("geoPdf");
        refreshFreeSpace();
      } else if (outcome.status === "existing") {
        info("Already imported.");
        setFilter("geoPdf");
      } else if (outcome.status === "paused") {
        info("Import paused — resume it from the GeoPDFs list.");
        setFilter("geoPdf");
      }
    },
    [info, refreshFreeSpace],
  );

  const geoPdfFailure = useCallback(
    (err: unknown, fallback: string) => {
      console.error(err);
      const code = (err as { code?: string }).code;
      fail((code && GEOPDF_ERRORS[code]) ?? messageFromError(err, fallback));
    },
    [fail],
  );

  const handleImportGeoPdf = useCallback(async () => {
    try {
      const token = startGeoPdfOp("Importing GeoPDF");
      finishGeoPdf(await importGeoPdfFromPicker(geoPdfProgress, token));
    } catch (err) {
      geoPdfFailure(err, "Couldn't import that PDF.");
    } finally {
      endGeoPdfOp();
    }
  }, [endGeoPdfOp, finishGeoPdf, geoPdfFailure, geoPdfProgress, startGeoPdfOp]);

  const handleResumeGeoPdf = useCallback(
    async (id: string, label: string) => {
      try {
        const token = startGeoPdfOp(`Resuming ${label}`);
        finishGeoPdf(await resumeGeoPdfImport(id, geoPdfProgress, token));
      } catch (err) {
        geoPdfFailure(err, "Couldn't finish that import.");
      } finally {
        endGeoPdfOp();
      }
    },
    [endGeoPdfOp, finishGeoPdf, geoPdfFailure, geoPdfProgress, startGeoPdfOp],
  );

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

  const handleImportAccountGeoPdf = useCallback(
    async (job: GeoPdfJobView) => {
      try {
        const token = startGeoPdfOp(`Importing ${job.title ?? "GeoPDF"}`);
        // Re-presign right before download — the listed URL may have expired
        // while this list was open.
        const fresh = await getGeoPdfJob(job.id);
        if (!fresh.downloadUrl) throw new Error("This GeoPDF isn't ready to download.");
        finishGeoPdf(
          await importGeoPdfFromUrl(
            fresh.title ?? "Logjam GeoPDF",
            fresh.downloadUrl,
            geoPdfProgress,
            token,
          ),
        );
      } catch (err) {
        geoPdfFailure(err, "Couldn't import that GeoPDF.");
      } finally {
        endGeoPdfOp();
      }
    },
    [endGeoPdfOp, finishGeoPdf, geoPdfFailure, geoPdfProgress, startGeoPdfOp],
  );

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
        locatable: geoPdf.bbox != null,
        resolveBbox: async () => geoPdf.bbox,
        rename: (name) => updateGeoPdfImport(geoPdf.id, { label: name }),
        delete: {
          confirmTitle: "Delete this GeoPDF?",
          confirmBody: "The imported map and its tiles are removed from the device.",
          run: () => deleteGeoPdfImport(geoPdf.id),
        },
      });
    }

    for (const imported of imports) {
      rows.push({
        key: imported.id,
        category: "vector",
        title: imported.name,
        subtitle: `${imported.featureCount} feature${imported.featureCount === 1 ? "" : "s"} · imported ${formatDay(imported.createdAt)}`,
        sizeBytes: imported.sizeBytes,
        locatable: true,
        resolveBbox: async () => imported.bbox,
        rename: (name) => renameVectorImport(imported.id, name),
        delete: {
          confirmTitle: "Delete this import?",
          confirmBody: "The imported features are removed from the device and the map.",
          run: () => deleteVectorImport(imported.id),
        },
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
        locatable: track.pointCount > 0,
        // A track's extent isn't stored; derive it from its points on demand.
        resolveBbox: async () => bboxOfPoints(await listTrackPoints(track.id)),
        rename: (name) => updateTrack(track.id, { name }),
        delete: {
          confirmTitle: "Delete track?",
          confirmBody: "The recorded points are deleted. This can't be undone.",
          run: () => deleteTrack(track.id),
        },
      });
    }

    return rows;
  }, [
    artifacts,
    geoPdfBusy,
    geoPdfImports,
    handleResumeGeoPdf,
    imports,
    overlayCatalog,
    regionArtifacts,
    savedTracks,
  ]);

  const counts = useMemo(() => {
    const byCategory = { region: 0, overlay: 0, geoPdf: 0, vector: 0, track: 0 };
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

  const showOnMap = useCallback(
    (item: SavedItem) => {
      item
        .resolveBbox()
        .then((bbox) => {
          if (!bbox) {
            fail("This one has no saved location to show.");
            return;
          }
          onOpenMap(bbox);
        })
        .catch((err: unknown) => {
          console.error(err);
          fail("Couldn't work out where this is.");
        });
    },
    [fail, onOpenMap],
  );

  const menuItem = items.find((item) => item.key === menuItemKey) ?? null;

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
        {!online || pendingCount > 0 ? (
          <View style={styles.pillRow}>
            {online ? null : <StatusPill label="Offline" tone="muted" icon="cloud-off" />}
            {pendingCount > 0 ? (
              <StatusPill
                label={`${pendingCount} waiting to sync`}
                tone="outline"
                icon="upload-cloud"
              />
            ) : null}
          </View>
        ) : null}
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
            right={
              activeOp.cancellable ? (
                <IconButton
                  icon="x"
                  accessibilityLabel="Cancel this import"
                  color={theme.warning}
                  onPress={() => {
                    if (geoPdfCancel.current) geoPdfCancel.current.cancelled = true;
                  }}
                />
              ) : undefined
            }
          />
        ) : null}

        {visibleItems.length === 0 && !activeOp ? (
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
                subtitle={online ? "Not on this device" : "Connect to download"}
                icon="layers"
                hue={assetHue.overlay}
                right={
                  <IconButton
                    icon="download"
                    accessibilityLabel={`Save ${overlay.label} for offline use`}
                    color={theme.accent}
                    disabled={!online || overlayBusyKey != null}
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
            subtitle="Pick an area on the map, then save its tiles"
            icon="map"
            hue={assetHue.region}
            onPress={() => {
              setAddSheetOpen(false);
              onOpenMap();
            }}
          />
          <Row
            title="Import a GeoPDF file"
            subtitle="From this phone's storage or a download"
            icon="file-text"
            hue={assetHue.geoPdf}
            onPress={() => {
              setAddSheetOpen(false);
              handleImportGeoPdf();
            }}
          />
          <Row
            title={accountJobsLoading ? "Loading your GeoPDFs…" : "GeoPDFs from my account"}
            subtitle={online ? "Maps you generated on the web" : "Needs a connection"}
            icon="cloud"
            hue={assetHue.geoPdf}
            onPress={
              online && !accountJobsLoading
                ? () => {
                    setAddSheetOpen(false);
                    loadAccountGeoPdfs();
                  }
                : undefined
            }
          />
          <Row
            title="Import GPX, KML or GeoJSON"
            subtitle="Tracks and waypoints from another app"
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
            subtitle={
              online ? "Contours, slope and vegetation you generated" : "Needs a connection"
            }
            icon="layers"
            hue={assetHue.overlay}
            onPress={
              online
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
        visible={menuItem != null}
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
              <Row
                title="Rename"
                icon="edit-2"
                hue={theme.bonus1}
                onPress={() => setMenuMode("rename")}
              />
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
  const copy: Record<Category | "all", { title: string; hint: string }> = {
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
      hint: online
        ? "Topo overlays you generate on the web can be saved for offline use."
        : "Connect to see the overlays on your account.",
    },
    geoPdf: {
      title: "No GeoPDF maps",
      hint: "Import a GeoPDF from this phone, or pull one from your Logjam account.",
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
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
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
