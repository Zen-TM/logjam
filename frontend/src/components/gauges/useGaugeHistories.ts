import { useEffect, useState } from "react";
import {
  gaugeHistoryUrl,
  parseGaugeHistory,
  type GaugeHistoryFile,
} from "@logjam/shared";

/**
 * The daily history of some gauges: public files, asked for once when the
 * section mounts (ADR 0044), with no timer. Null until every request has
 * finished; a missing file (the job has not written it yet), a failed fetch
 * and a malformed file each leave that gauge out.
 */
export function useGaugeHistories(
  ids: string[],
): Record<string, GaugeHistoryFile> | null {
  const key = ids.join(",");
  const [found, setFound] = useState<Record<string, GaugeHistoryFile> | null>(
    null,
  );
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    Promise.all(
      key.split(",").map(async (id) => {
        const url = gaugeHistoryUrl("", id);
        try {
          const res = url && (await fetch(url, { signal: controller.signal }));
          return [
            id,
            res && res.ok ? parseGaugeHistory(await res.json()) : null,
          ];
        } catch {
          return [id, null];
        }
      }),
    ).then((list) => {
      if (controller.signal.aborted) return;
      setFound(Object.fromEntries(list.filter((entry) => entry[1] !== null)));
    });
    return () => controller.abort();
  }, [key]);
  return found;
}
