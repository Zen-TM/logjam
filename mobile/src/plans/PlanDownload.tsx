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
  importGeoPdfFile,
  importGeoPdfFromUrl,
} from "../geopdf/importPipeline";
import { runGeoPdfImport } from "../geopdf/importRunner";
import {
  linkPlanGeoPdfImport,
  missingPlanFiles,
  openablePlanMedia,
  planFiles,
  planFileSource,
  type PlanFile,
} from "./planFiles";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { planBbox, planMapSaved } from "./planMap";
import { planForUrls, type CachedPlan } from "./plansCache";

export function PlanDownload({
  cached,
  online,
  now,
  onDownloadMap,
}: {
  cached: CachedPlan;
  online: boolean;
  /** For "Downloaded 3 days ago". */
  now: number;
  onDownloadMap: (bbox: [number, number, number, number]) => void;
}) {
  const { plan } = cached;
  const [missing, setMissing] = useState<PlanFile[] | null>(null);
  const progress = usePlanDownload(plan.id);
  const { artifacts } = useMapArtifacts();
  const running = progress !== null;

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

  if (progress)
    return (
      <Row
        icon="saveOffline"
        title={TRIP_PLAN_OFFLINE.downloading}
        subtitle={`${formatBytes(progress.done)} of ${formatBytes(progress.total)}. ${TRIP_PLAN_OFFLINE.downloadKeepOpen}`}
        progress={progress.total > 0 ? progress.done / progress.total : 0}
      />
    );
  if (missing === null) return null;
  if (cached.downloadedAt && missing.length === 0) {
    const bbox = planBbox(plan);
    const mapSaved = bbox !== null && planMapSaved(bbox, artifacts);
    return (
      <>
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
        {bbox && !mapSaved ? (
          <Row
            icon="map"
            title={TRIP_PLAN_OFFLINE.downloadMap}
            subtitle={
              online ? undefined : unavailableReasonText("needs-connection")
            }
            disabled={!online}
            onPress={() => onDownloadMap(bbox)}
            style={{ marginTop: spacing(1) }}
          />
        ) : null}
      </>
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
      subtitle={
        online ? price || undefined : unavailableReasonText("needs-connection")
      }
      disabled={!online}
      onPress={() => void startPlanDownload(plan.id)}
      style={{ marginTop: spacing(1) }}
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

/**
 * A plan's GeoPDF onto the map through the GeoPDF import, from the phone's
 * copy or its URL. A new import is the plan's (`linkPlanGeoPdfImport`) and
 * leaves the phone with it; one already there (the caller's own, or this
 * plan's from before) is left as it is. The import's toast says how it went.
 */
export async function openPlanGeoPdf(
  planId: string,
  geoPdfId: string,
  title: string,
  files: readonly PlanFile[],
  onPhone: ReadonlySet<string>,
  online: boolean,
): Promise<void> {
  const fresh = await filesForOpening(
    planId,
    [geoPdfId],
    files,
    onPhone,
    online,
  );
  const source = planFileSource(
    planId,
    fresh.find((file) => file.id === geoPdfId),
    onPhone,
    online,
  );
  if (!source) return;
  const outcome = await runGeoPdfImport(title, (onProgress, token) =>
    source.startsWith("file:")
      ? importGeoPdfFile(title, source, onProgress, token)
      : importGeoPdfFromUrl(title, source, onProgress, token),
  );
  if (outcome?.status === "imported" || outcome?.status === "paused")
    await linkPlanGeoPdfImport(planId, geoPdfId, outcome.record.id).catch(
      console.error,
    );
}
