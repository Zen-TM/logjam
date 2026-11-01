// Download for the trip, in a plan's hero: priced before it runs ("14 files,
// 230 MB"), a progress row while it runs (mobile/DESIGN.md §4: long work is a
// progress card), and Downloaded, with when, once every file the plan points
// at is on the phone. A plan that gained files since keeps its stamp but
// offers the rest. The run is `planDownloads.ts`'s, so it outlives this row.
// Once downloaded, the map for the plan's area is offered: the region
// download.
import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  formatBytes,
  planCountsLabel,
  TRIP_PLAN_OFFLINE,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { relativeTime } from "../screens/syncHealth";
import { spacing } from "../theme";
import { Row, StatusPill } from "../ui";
import { startPlanDownload, usePlanDownload } from "./planDownloads";
import {
  missingPlanFiles,
  openablePlanMedia,
  planFiles,
  type PlanFile,
} from "./planFiles";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { planBbox, planMapSaved } from "./planMap";
import { planForUrls, type CachedPlan } from "./plansCache";

/** Which files of the plan are not on the phone, read again as a run ends;
 *  null until read. */
function useMissingFiles(plan: CachedPlan["plan"], running: boolean) {
  const [missing, setMissing] = useState<PlanFile[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await missingPlanFiles(plan.id, planFiles(plan));
      if (!cancelled) setMissing(next);
    })().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [plan, running]);
  return missing;
}

/** The state of the download, in the plan's hero: the progress row while it
 *  runs, and Downloaded with when. Starting one is `PlanDownloadRows`, on the
 *  plan's ⋯. */
export function PlanDownload({
  cached,
  now,
}: {
  cached: CachedPlan;
  /** For "Downloaded 3 days ago". */
  now: number;
}) {
  const { plan } = cached;
  const progress = usePlanDownload(plan.id);
  const missing = useMissingFiles(plan, progress !== null);
  const { artifacts } = useMapArtifacts();

  if (progress)
    return (
      <Row
        icon="saveOffline"
        title={TRIP_PLAN_OFFLINE.downloading}
        subtitle={`${formatBytes(progress.done)} of ${formatBytes(progress.total)}. ${TRIP_PLAN_OFFLINE.downloadKeepOpen}`}
        progress={progress.total > 0 ? progress.done / progress.total : 0}
      />
    );
  if (!missing || !cached.downloadedAt || missing.length > 0) return null;
  const bbox = planBbox(plan);
  const mapSaved = bbox !== null && planMapSaved(bbox, artifacts);
  return (
    <View style={{ flexDirection: "row", gap: spacing(1) }}>
      <StatusPill
        label={`${TRIP_PLAN_OFFLINE.downloaded} ${relativeTime(cached.downloadedAt, now)}`}
        tone="muted"
        icon="saveOffline"
      />
      {mapSaved ? (
        <StatusPill
          label={TRIP_PLAN_OFFLINE.mapDownloaded}
          tone="muted"
          icon="map"
        />
      ) : null}
    </View>
  );
}

/** The plan's ⋯ rows that start work: Download for this trip, priced before it
 *  runs ("14 files, 230 MB"), or what a downloaded plan lacks (a plan that
 *  gained files since offers the rest), and then the map for its area. Draws
 *  nothing while a run is going: the hero shows that. */
export function PlanDownloadRows({
  cached,
  online,
  onDownloadMap,
  onStarted,
}: {
  cached: CachedPlan;
  online: boolean;
  onDownloadMap: (bbox: [number, number, number, number]) => void;
  /** A row was pressed: the sheet holding them closes. */
  onStarted: () => void;
}) {
  const { plan } = cached;
  const running = usePlanDownload(plan.id) !== null;
  const missing = useMissingFiles(plan, running);
  const { artifacts } = useMapArtifacts();
  if (running || missing === null) return null;
  const reason = online ? undefined : unavailableReasonText("needs-connection");

  if (cached.downloadedAt && missing.length === 0) {
    const bbox = planBbox(plan);
    if (!bbox || planMapSaved(bbox, artifacts)) return null;
    return (
      <Row
        icon="map"
        title={TRIP_PLAN_OFFLINE.downloadMap}
        subtitle={reason}
        disabled={!online}
        onPress={() => {
          onStarted();
          onDownloadMap(bbox);
        }}
      />
    );
  }

  const bytes = missing.reduce((sum, file) => sum + file.sizeBytes, 0);
  const price = planCountsLabel(
    { files: missing.length },
    missing.length > 0 ? formatBytes(bytes) : undefined,
  );
  return (
    <Row
      icon="saveOffline"
      title={TRIP_PLAN_OFFLINE.download}
      subtitle={reason ?? (price || undefined)}
      disabled={!online}
      onPress={() => {
        onStarted();
        void startPlanDownload(plan.id);
      }}
    />
  );
}

/** Which of these files of a plan are on the phone, read again as a download
 *  ends. `files` is memoised by the caller. */
export function usePlanFilesOnPhone(
  planId: string,
  files: readonly PlanFile[],
): ReadonlySet<string> {
  const running = usePlanDownload(planId) !== null;
  const [onPhone, setOnPhone] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    void missingPlanFiles(planId, files)
      .then((missing) => {
        if (cancelled) return;
        const absent = new Set(missing.map((file) => file.id));
        setOnPhone(
          new Set(
            files.filter((file) => !absent.has(file.id)).map((file) => file.id),
          ),
        );
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [planId, files, running]);
  return onPhone;
}

/** The files to open these from. A URL from a copy fetched long ago may have
 *  expired, so the plan is fetched again first (`planForUrls`); downloaded
 *  files, or offline, need nothing. */
async function filesForOpening(
  planId: string,
  ids: readonly string[],
  files: readonly PlanFile[],
  onPhone: ReadonlySet<string>,
  online: boolean,
): Promise<readonly PlanFile[]> {
  if (!online || ids.every((id) => onPhone.has(id))) return files;
  return planFiles(await planForUrls(planId));
}

/** The media that opens now, each with where it opens from. */
export async function openPlanMedia<T extends { id: string }>(
  planId: string,
  items: readonly T[],
  files: readonly PlanFile[],
  onPhone: ReadonlySet<string>,
  online: boolean,
) {
  const ids = items.map((item) => item.id);
  const fresh = await filesForOpening(planId, ids, files, onPhone, online);
  return openablePlanMedia(planId, items, fresh, onPhone, online);
}
