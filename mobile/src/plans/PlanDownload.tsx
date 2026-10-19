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
import { missingPlanFiles, planFiles, type PlanFile } from "./planFiles";
import { planBbox } from "./planMap";
import type { CachedPlan } from "./plansCache";

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
    return (
      <>
        <View style={{ flexDirection: "row" }}>
          <StatusPill
            label={`${TRIP_PLAN_OFFLINE.downloaded} ${relativeTime(cached.downloadedAt, now)}`}
            tone="muted"
            icon="saveOffline"
          />
        </View>
        {bbox ? (
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
