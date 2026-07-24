// Saved tab — on-device map asset MANAGEMENT: downloaded regions/overlays,
// GeoPDF + vector-file imports, recorded tracks. Split out of the Map
// screen's "Map layers" sheet (which keeps only viewport-bound actions and
// per-asset visibility toggles) — see MapScreen.tsx's header comment for the
// full display/management split.
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
// labels ("Saved region"), user-supplied names (GeoPDF/track titles, topo job
// names), and sizes/dates only.
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
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
import { fontSize, hitSlop, spacing, theme } from "../theme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { ScreenScroll } from "../ui/Screen";
import { SectionHeader } from "../ui/SectionHeader";
import { StatGrid } from "../ui/StatGrid";
import { StatusPill } from "../ui/StatusPill";
import { TextField } from "../ui/TextField";
import {
  GEOPDF_ERRORS,
  deleteGeoPdfImport,
  importGeoPdfFromPicker,
  importGeoPdfFromUrl,
  resumeGeoPdfImport,
  type GeoPdfCancelToken,
  type GeoPdfProgress,
} from "../geopdf/importPipeline";
import { useGeoPdfImports } from "../geopdf/useGeoPdfImports";
import { deleteVectorImport, importVectorFileFromPicker } from "../imports/vectorImports";
import { useVectorImports } from "../imports/useVectorImports";
import { useConnectivity } from "../map/connectivity";
import { mergeSavedOverlayJobs, type CompletedOverlaysResponse } from "../map/topoOverlays";
import { downloadTopoOverlay } from "../offline/overlayDownloads";
import { deleteDownloadedArtifact } from "../offline/regionDownloads";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { deleteTrack, updateTrack, type Track } from "../tracks/tracksDb";
import { useTracks } from "../tracks/useTracks";

function getCompletedOverlays(): Promise<CompletedOverlaysResponse> {
  return apiFetch<CompletedOverlaysResponse>("/topo-jobs/completed-overlays");
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function SavedScreen() {
  const connectivity = useConnectivity();

  // Free device space is a point-in-time read; refresh whenever this tab
  // regains focus (a delete/save on this same screen updates it directly).
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const refreshFreeSpace = useCallback(() => {
    FileSystem.getFreeDiskStorageAsync().then(setFreeBytes).catch(console.error);
  }, []);
  useFocusEffect(refreshFreeSpace);

  // --- Downloaded regions + topo overlays (registry-backed) ---
  const { artifacts } = useMapArtifacts();
  const regionArtifacts = artifacts.filter((a) => a.kind === "basemap-region");

  const overlaysQuery = useApiQuery(getCompletedOverlays, "Couldn't load topo overlays.");
  const mergedOverlays = mergeSavedOverlayJobs(overlaysQuery.data, artifacts);
  const overlayList = mergedOverlays.jobs.flatMap((job) =>
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

  const [overlayBusy, setOverlayBusy] = useState<string | null>(null);
  const [overlayPct, setOverlayPct] = useState<number | null>(null);
  const [overlayStatus, setOverlayStatus] = useState<string | null>(null);
  const handleSaveOverlay = useCallback(
    async (item: {
      key: string;
      jobId: string;
      layer: TopoLayerName;
      format: TopoLayerFormat;
      pmtilesUrl: string;
    }) => {
      try {
        if (!(await confirmCellularOk())) return;
        setOverlayStatus(null);
        setOverlayPct(null);
        setOverlayBusy(item.key);
        await downloadTopoOverlay(
          {
            jobId: item.jobId,
            layer: item.layer,
            format: item.format,
            pmtilesUrl: item.pmtilesUrl,
          },
          (p) =>
            setOverlayPct(
              p.bytesTotal > 0
                ? Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100))
                : null,
            ),
        );
        setOverlayStatus("Overlay saved for offline use.");
        refreshFreeSpace();
      } catch (err) {
        console.error(err);
        setOverlayStatus(messageFromError(err, "Couldn't save this overlay."));
      } finally {
        setOverlayBusy(null);
        setOverlayPct(null);
      }
    },
    [confirmCellularOk, refreshFreeSpace],
  );

  // --- Vector imports (GPX/KML/GeoJSON) ---
  const { imports } = useVectorImports();
  const [importBusy, setImportBusy] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const handleImportFile = useCallback(async () => {
    try {
      setImportStatus(null);
      setImportBusy(true);
      const outcome = await importVectorFileFromPicker(imports.length);
      if (outcome.status === "imported") {
        setImportStatus("Imported.");
        refreshFreeSpace();
      }
    } catch (err) {
      console.error(err);
      setImportStatus(messageFromError(err, "Couldn't import that file."));
    } finally {
      setImportBusy(false);
    }
  }, [imports.length, refreshFreeSpace]);

  // --- GeoPDF imports ---
  const { geoPdfImports } = useGeoPdfImports();
  const [geoPdfBusy, setGeoPdfBusy] = useState(false);
  const [geoPdfStatus, setGeoPdfStatus] = useState<string | null>(null);
  const [geoPdfPct, setGeoPdfPct] = useState<number | null>(null);
  const geoPdfCancel = useRef<GeoPdfCancelToken | null>(null);

  const geoPdfProgress = useCallback((progress: GeoPdfProgress) => {
    if (progress.phase === "rasterising" || progress.phase === "overviews") {
      setGeoPdfPct(Math.round(progress.fraction * 100));
    } else {
      setGeoPdfPct(null);
    }
  }, []);

  const finishGeoPdf = useCallback(
    (outcome: Awaited<ReturnType<typeof importGeoPdfFromPicker>>) => {
      if (outcome.status === "imported") {
        setGeoPdfStatus("GeoPDF imported.");
        refreshFreeSpace();
      } else if (outcome.status === "existing") {
        setGeoPdfStatus("Already imported.");
      } else if (outcome.status === "paused") {
        setGeoPdfStatus("Import paused — resume it below.");
      }
    },
    [refreshFreeSpace],
  );

  const handleImportGeoPdf = useCallback(async () => {
    try {
      setGeoPdfStatus(null);
      setGeoPdfBusy(true);
      geoPdfCancel.current = { cancelled: false };
      finishGeoPdf(await importGeoPdfFromPicker(geoPdfProgress, geoPdfCancel.current));
    } catch (err) {
      console.error(err);
      const code = (err as { code?: string }).code;
      setGeoPdfStatus(
        (code && GEOPDF_ERRORS[code]) ?? messageFromError(err, "Couldn't import that PDF."),
      );
    } finally {
      setGeoPdfBusy(false);
      setGeoPdfPct(null);
      geoPdfCancel.current = null;
    }
  }, [finishGeoPdf, geoPdfProgress, geoPdfCancel]);

  const handleResumeGeoPdf = useCallback(
    async (id: string) => {
      try {
        setGeoPdfStatus(null);
        setGeoPdfBusy(true);
        geoPdfCancel.current = { cancelled: false };
        finishGeoPdf(await resumeGeoPdfImport(id, geoPdfProgress, geoPdfCancel.current));
      } catch (err) {
        console.error(err);
        const code = (err as { code?: string }).code;
        setGeoPdfStatus(
          (code && GEOPDF_ERRORS[code]) ??
            messageFromError(err, "Couldn't finish that import."),
        );
      } finally {
        setGeoPdfBusy(false);
        setGeoPdfPct(null);
        geoPdfCancel.current = null;
      }
    },
    [finishGeoPdf, geoPdfProgress, geoPdfCancel],
  );

  // Import your own server-generated GeoPDFs: list the account's completed
  // jobs on demand (online-only), then stream a chosen one's presigned bytes
  // into the same on-device pipeline. Loaded lazily on a tap, not on mount.
  const [accountJobs, setAccountJobs] = useState<GeoPdfJobView[] | null>(null);
  const [accountJobsLoading, setAccountJobsLoading] = useState(false);
  const [accountJobsStatus, setAccountJobsStatus] = useState<string | null>(null);

  const loadAccountGeoPdfs = useCallback(async () => {
    try {
      setAccountJobsStatus(null);
      setAccountJobsLoading(true);
      const jobs = await listGeoPdfJobs();
      setAccountJobs(jobs.filter((job) => job.status === "completed"));
    } catch (err) {
      console.error(err);
      setAccountJobsStatus(messageFromError(err, "Couldn't load your GeoPDFs."));
    } finally {
      setAccountJobsLoading(false);
    }
  }, []);

  const handleImportAccountGeoPdf = useCallback(
    async (job: GeoPdfJobView) => {
      try {
        setGeoPdfStatus(null);
        setGeoPdfBusy(true);
        geoPdfCancel.current = { cancelled: false };
        // Re-presign right before download — the listed URL may have expired
        // while this list was open.
        const fresh = await getGeoPdfJob(job.id);
        if (!fresh.downloadUrl) {
          throw new Error("This GeoPDF isn't ready to download.");
        }
        finishGeoPdf(
          await importGeoPdfFromUrl(
            fresh.title ?? "Logjam GeoPDF",
            fresh.downloadUrl,
            geoPdfProgress,
            geoPdfCancel.current,
          ),
        );
      } catch (err) {
        console.error(err);
        const code = (err as { code?: string }).code;
        setGeoPdfStatus(
          (code && GEOPDF_ERRORS[code]) ??
            messageFromError(err, "Couldn't import that GeoPDF."),
        );
      } finally {
        setGeoPdfBusy(false);
        setGeoPdfPct(null);
        geoPdfCancel.current = null;
      }
    },
    [finishGeoPdf, geoPdfProgress, geoPdfCancel],
  );

  // --- Tracks ---
  const { tracks } = useTracks();
  const savedTracks = tracks.filter((track) => track.state === "done");

  const usedBytes =
    artifacts.reduce((sum, a) => sum + a.sizeBytes, 0) +
    geoPdfImports.reduce((sum, gp) => sum + gp.sourceSizeBytes, 0) +
    imports.reduce((sum, imp) => sum + imp.sizeBytes, 0);

  return (
    <ScreenScroll>
      <StatGrid
        stats={[
          { label: "Used", value: formatBytes(usedBytes) },
          { label: "Free", value: freeBytes != null ? formatBytes(freeBytes) : "…" },
        ]}
      />

      <SectionHeader label="Downloaded regions" />
      {regionArtifacts.length === 0 ? (
        <Text style={styles.hint}>
          Download the current map area from the Map tab&apos;s layers sheet.
        </Text>
      ) : null}
      {regionArtifacts.map((artifact) => (
        <Row
          key={artifact.id}
          title="Saved region"
          subtitle={`${new Date(artifact.downloadedAt).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          })} · ${formatBytes(artifact.sizeBytes)}`}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete saved region"
              hitSlop={hitSlop}
              onPress={() => {
                deleteDownloadedArtifact(artifact.id)
                  .then(refreshFreeSpace)
                  .catch(console.error);
              }}
            >
              <Feather name="trash-2" size={18} color={theme.warning} />
            </Pressable>
          }
        />
      ))}

      <SectionHeader label="Topo overlays" />
      {overlayList.length === 0 ? (
        <Text style={styles.hint}>No topo overlays available yet.</Text>
      ) : null}
      {overlayList.map((overlay) => {
        const saved = artifacts.find(
          (a) => a.kind === "topo-overlay" && a.logicalKey === overlay.key,
        );
        const busy = overlayBusy === overlay.key;
        return (
          <Card key={overlay.key} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {overlay.label}
              </Text>
              {saved ? (
                <Text style={styles.rowSub}>{formatBytes(saved.sizeBytes)}</Text>
              ) : null}
            </View>
            {saved ? (
              <>
                <StatusPill label="Downloaded" tone="accent" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete saved overlay"
                  hitSlop={hitSlop}
                  onPress={() => {
                    deleteDownloadedArtifact(saved.id)
                      .then(refreshFreeSpace)
                      .catch(console.error);
                  }}
                >
                  <Feather name="trash-2" size={18} color={theme.warning} />
                </Pressable>
              </>
            ) : busy ? (
              <Text style={styles.rowSub}>{overlayPct != null ? `${overlayPct}%` : "…"}</Text>
            ) : connectivity === "online" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save overlay for offline use"
                hitSlop={hitSlop}
                disabled={overlayBusy != null}
                onPress={() => handleSaveOverlay(overlay)}
              >
                <Feather
                  name="download"
                  size={18}
                  color={overlayBusy != null ? theme.textMuted : theme.accent}
                />
              </Pressable>
            ) : null}
          </Card>
        );
      })}
      {overlayStatus ? <Text style={styles.hint}>{overlayStatus}</Text> : null}

      <SectionHeader label="GeoPDF maps" />
      <View style={styles.actionsRow}>
        <Button
          label="Import from file"
          variant="outlineAccent"
          onPress={handleImportGeoPdf}
          disabled={geoPdfBusy}
        />
        {connectivity === "online" ? (
          <Button
            label={
              accountJobsLoading
                ? "Loading…"
                : accountJobs
                  ? "Refresh account GeoPDFs"
                  : "From my account"
            }
            variant="outlineAccent"
            onPress={loadAccountGeoPdfs}
            disabled={geoPdfBusy || accountJobsLoading}
          />
        ) : null}
      </View>
      {geoPdfBusy ? (
        <Text style={styles.hint}>
          {geoPdfPct != null ? `Importing… ${geoPdfPct}%` : "Importing…"}
        </Text>
      ) : null}
      {geoPdfStatus ? <Text style={styles.hint}>{geoPdfStatus}</Text> : null}
      {accountJobsStatus ? <Text style={styles.hint}>{accountJobsStatus}</Text> : null}
      {accountJobs != null && accountJobs.length === 0 ? (
        <Text style={styles.hint}>No generated GeoPDFs on your account yet.</Text>
      ) : null}
      {accountJobs?.map((job) => (
        <Row
          key={job.id}
          title={job.title ?? "Untitled GeoPDF"}
          subtitle={job.resultBytes != null ? formatBytes(job.resultBytes) : undefined}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Import this GeoPDF for offline use"
              hitSlop={hitSlop}
              disabled={geoPdfBusy}
              onPress={() => handleImportAccountGeoPdf(job)}
            >
              <Feather
                name="download"
                size={18}
                color={geoPdfBusy ? theme.textMuted : theme.accent}
              />
            </Pressable>
          }
        />
      ))}
      {geoPdfImports.length === 0 ? (
        <Text style={styles.hint}>No GeoPDFs imported yet.</Text>
      ) : null}
      {geoPdfImports.map((geoPdf) => (
        <View key={geoPdf.id} style={styles.stackRow}>
          <Card style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {geoPdf.label}
              </Text>
              <Text style={styles.rowSub}>{formatBytes(geoPdf.sourceSizeBytes)}</Text>
            </View>
            {geoPdf.state === "failed" ? (
              <StatusPill label="Failed" tone="warning" />
            ) : geoPdf.state !== "ready" ? (
              <StatusPill label="Incomplete" tone="outline" />
            ) : null}
            {geoPdf.state !== "ready" && !geoPdfBusy ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Resume import"
                hitSlop={hitSlop}
                onPress={() => handleResumeGeoPdf(geoPdf.id)}
              >
                <Text style={styles.actionLabel}>Resume</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete GeoPDF import"
              hitSlop={hitSlop}
              onPress={() => {
                deleteGeoPdfImport(geoPdf.id).then(refreshFreeSpace).catch(console.error);
              }}
            >
              <Feather name="trash-2" size={18} color={theme.warning} />
            </Pressable>
          </Card>
          {geoPdf.state === "failed" && geoPdf.errorCode ? (
            <Text style={styles.hint}>
              {GEOPDF_ERRORS[geoPdf.errorCode] ?? "Import failed."}
            </Text>
          ) : null}
        </View>
      ))}
      {geoPdfBusy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel import"
          onPress={() => {
            if (geoPdfCancel.current) geoPdfCancel.current.cancelled = true;
          }}
          style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
        >
          <Text style={styles.cancelLabel}>Cancel import</Text>
        </Pressable>
      ) : null}

      <SectionHeader label="Imports" />
      <Button
        label="Import file (GPX / KML / GeoJSON)"
        variant="outlineAccent"
        onPress={handleImportFile}
        disabled={importBusy}
      />
      {importStatus ? <Text style={styles.hint}>{importStatus}</Text> : null}
      {imports.length === 0 ? <Text style={styles.hint}>No files imported yet.</Text> : null}
      {imports.map((imported) => (
        <Row
          key={imported.id}
          leading={<View style={[styles.dot, { backgroundColor: imported.color }]} />}
          title={imported.name}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete import"
              hitSlop={hitSlop}
              onPress={() => {
                deleteVectorImport(imported.id).then(refreshFreeSpace).catch(console.error);
              }}
            >
              <Feather name="trash-2" size={18} color={theme.warning} />
            </Pressable>
          }
        />
      ))}

      <SectionHeader label="Tracks" />
      {savedTracks.length === 0 ? (
        <Text style={styles.hint}>Recorded tracks will appear here.</Text>
      ) : null}
      {savedTracks.map((track) => (
        <TrackRow key={track.id} track={track} />
      ))}
    </ScreenScroll>
  );
}

function TrackRow({ track }: { track: Track }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(track.name);

  const commitRename = useCallback(() => {
    const name = draftName.trim();
    if (name && name !== track.name) {
      updateTrack(track.id, { name }).catch(console.error);
    }
    setEditing(false);
  }, [draftName, track.id, track.name]);

  if (editing) {
    return (
      <Card style={styles.row}>
        <View style={styles.rowMain}>
          <TextField
            label="Track name"
            value={draftName}
            onChangeText={setDraftName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={commitRename}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save track name"
          hitSlop={hitSlop}
          onPress={commitRename}
        >
          <Text style={styles.actionLabel}>Save</Text>
        </Pressable>
      </Card>
    );
  }

  return (
    <Card style={styles.row}>
      <View style={[styles.dot, { backgroundColor: track.color }]} />
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {track.name}
        </Text>
        <Text style={styles.rowSub}>{formatDistanceM(track.distanceM)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Rename track"
        hitSlop={hitSlop}
        onPress={() => {
          setDraftName(track.name);
          setEditing(true);
        }}
      >
        <Feather name="edit-2" size={18} color={theme.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete track"
        hitSlop={hitSlop}
        onPress={() => {
          Alert.alert(
            "Delete track?",
            "The recorded points are deleted. This can't be undone.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  deleteTrack(track.id).catch(console.error);
                },
              },
            ],
          );
        }}
      >
        <Feather name="trash-2" size={18} color={theme.warning} />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  hint: { color: theme.textMuted, fontSize: fontSize.sm, marginTop: spacing(0.5) },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1), marginTop: spacing(1) },
  actionRow: { minHeight: 44, justifyContent: "center", marginTop: spacing(1) },
  pressed: { opacity: 0.7 },
  cancelLabel: { color: theme.warning, fontSize: fontSize.sm, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    marginTop: spacing(1),
  },
  rowMain: { flex: 1, gap: spacing(0.5) },
  rowLabel: { color: theme.textPrimary, fontSize: fontSize.base, fontWeight: "600" },
  rowSub: { color: theme.textMuted, fontSize: fontSize.xs },
  actionLabel: { color: theme.accent, fontSize: fontSize.base, fontWeight: "600" },
  stackRow: { gap: spacing(0.5) },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
