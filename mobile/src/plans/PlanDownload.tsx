// Download for the trip, in a plan's hero (design §8): priced before it runs
// ("14 files, 230 MB"), a progress row while it runs (long work is a progress
// card), and Downloaded once every file the plan points at is on the phone.
// A plan that gained files since keeps its stamp but offers the rest.
import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  formatBytes,
  messageFromError,
  planCountsLabel,
  TRIP_PLAN_OFFLINE,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { spacing } from "../theme";
import { Row, StatusPill } from "../ui";
import { missingPlanFiles, planFiles, type PlanFile } from "./planFiles";
import { downloadPlan, type CachedPlan } from "./plansCache";

export function PlanDownload({
  cached,
  online,
  onInfo,
  onError,
}: {
  cached: CachedPlan;
  online: boolean;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { plan } = cached;
  const [missing, setMissing] = useState<PlanFile[] | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await missingPlanFiles(plan.id, planFiles(plan));
      if (!cancelled) setMissing(next);
    })().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [plan]);

  if (missing === null) return null;
  if (progress)
    return (
      <Row
        icon="saveOffline"
        title={TRIP_PLAN_OFFLINE.downloading}
        subtitle={`${formatBytes(progress.done)} of ${formatBytes(progress.total)}`}
        progress={progress.total > 0 ? progress.done / progress.total : 0}
      />
    );
  if (cached.downloadedAt && missing.length === 0)
    return (
      <View style={{ flexDirection: "row" }}>
        <StatusPill
          label={TRIP_PLAN_OFFLINE.downloaded}
          tone="muted"
          icon="saveOffline"
        />
      </View>
    );

  const bytes = missing.reduce((sum, file) => sum + file.sizeBytes, 0);
  const price = planCountsLabel(
    { files: missing.length },
    missing.length > 0 ? formatBytes(bytes) : undefined,
  );
  const run = () => {
    setProgress({ done: 0, total: bytes });
    downloadPlan(plan.id, (done, total) => setProgress({ done, total }))
      .then(() => onInfo(TRIP_PLAN_OFFLINE.downloadDone))
      .catch((err: unknown) =>
        onError(messageFromError(err, TRIP_PLAN_OFFLINE.downloadFailed)),
      )
      .finally(() => setProgress(null));
  };
  return (
    <Row
      icon="saveOffline"
      title={TRIP_PLAN_OFFLINE.download}
      subtitle={
        online ? price || undefined : unavailableReasonText("needs-connection")
      }
      disabled={!online}
      onPress={run}
      style={{ marginTop: spacing(1) }}
    />
  );
}
