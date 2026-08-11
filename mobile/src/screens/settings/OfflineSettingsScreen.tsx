// Settings → Offline and storage: what this phone fetches without being asked,
// what it may spend mobile data on, and where the things it already holds are
// managed.
//
// The auto-download switches became DEVICE preferences with this page (see
// `geopdf/autoDownloadPreference.ts`, `offline/topoAutoDownload.ts`): whether
// this handset should spend tens of megabytes and a couple of minutes of
// rasterising is a fact about the handset, not about the person, and as account
// preferences they needed a connection to change — which is the state you are
// most likely to be in when you want them off.
//
// The data switches are separate from the download switches on purpose. "Should
// this happen at all" and "may it happen on my mobile plan" are different
// questions, and folding them into one three-way control means a user who wants
// a GeoPDF the moment it is ready, but only on Wi-Fi, has nothing to pick.
//
// The storage row is a POINTER, not a duplicate. Saved is the inventory screen
// and owns the per-item actions (DESIGN.md §7 — the three verbs follow the asset
// wherever it is listed); re-listing downloads here would be a second place for
// them to go stale.
//
// PRIVACY: five booleans. No canyon names, no regions named.
import { useCallback, useState } from "react";

import {
  isAutoDownloadEnabled,
  setAutoDownloadEnabled,
} from "../../geopdf/autoDownloadPreference";
import {
  isMeteredAllowed,
  setMeteredAllowed,
  type MeteredJob,
} from "../../offline/networkPolicy";
import {
  isTopoAutoDownloadEnabled,
  setTopoAutoDownloadEnabled,
} from "../../offline/topoAutoDownload";
import { Row, ScreenScroll, SectionHeader, Toast, type ToastMessage } from "../../ui";
import { PreferenceRow } from "./settingsKit";

/**
 * `needs` names the auto-download switch a row is meaningless without: a data
 * allowance for work that isn't happening governs nothing, so those rows go
 * dead with the reason in place of their subtitle (DESIGN.md §10). Sync has no
 * such switch — it always runs — so it has none.
 */
const METERED_ROWS: {
  job: MeteredJob;
  title: string;
  subtitle: string;
  needs?: "geoPdf" | "topo";
}[] = [
  {
    job: "geoPdfDownload",
    title: "GeoPDF auto-downloads",
    subtitle: "Tens of megabytes each.",
    needs: "geoPdf",
  },
  {
    job: "topoDownload",
    title: "Topo auto-downloads",
    subtitle: "Tens of megabytes each.",
    needs: "topo",
  },
  {
    job: "sync",
    title: "Syncing trips and canyons",
    subtitle: "Usually a few kilobytes.",
  },
];

export function OfflineSettingsScreen({
  onOpenSaved,
}: {
  onOpenSaved: () => void;
}) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string) => {
    setToast({ text, tone: "error", nonce: Date.now() });
  }, []);
  const stored = useCallback(
    (ok: boolean) => {
      if (!ok) notify("This phone wouldn't store that setting.");
      return ok;
    },
    [notify],
  );

  const [autoDownload, setAutoDownload] = useState(isAutoDownloadEnabled);
  const [topoAutoDownload, setTopoAutoDownload] = useState(isTopoAutoDownloadEnabled);
  // One object rather than three booleans: the rows are data (METERED_ROWS), so
  // their state has to be indexable by the same key.
  const [metered, setMetered] = useState<Record<MeteredJob, boolean>>(() => ({
    geoPdfDownload: isMeteredAllowed("geoPdfDownload"),
    topoDownload: isMeteredAllowed("topoDownload"),
    sync: isMeteredAllowed("sync"),
  }));

  return (
    <>
      <ScreenScroll>
        <SectionHeader label="Fetch automatically" />
        <PreferenceRow
          icon="download"
          title="Finished GeoPDFs"
          subtitle="GeoPDFs generated on the web are automatically downloaded to this device."
          value={autoDownload}
          ready
          onToggle={() => {
            const next = !autoDownload;
            if (!stored(setAutoDownloadEnabled(next))) return;
            setAutoDownload(next);
          }}
        />
        <PreferenceRow
          icon="layers"
          title="Finished LiDAR topos"
          subtitle="LiDAR topos generated on the web are automatically downloaded to this device."
          value={topoAutoDownload}
          ready
          onToggle={() => {
            const next = !topoAutoDownload;
            if (!stored(setTopoAutoDownloadEnabled(next))) return;
            setTopoAutoDownload(next);
          }}
        />

        <SectionHeader label="Allow on mobile data" />
        {METERED_ROWS.map((row) => {
          const off =
            (row.needs === "geoPdf" && !autoDownload) ||
            (row.needs === "topo" && !topoAutoDownload);
          return (
            <PreferenceRow
              key={row.job}
              title={row.title}
              subtitle={off ? "Auto-download is off" : row.subtitle}
              value={metered[row.job]}
              ready={!off}
              onToggle={() => {
                const next = !metered[row.job];
                if (!stored(setMeteredAllowed(row.job, next))) return;
                setMetered((current) => ({ ...current, [row.job]: next }));
              }}
            />
          );
        })}

        <SectionHeader label="On this phone" />
        <Row
          icon="hard-drive"
          title="Maps, imports and tracks"
          subtitle="Managed on the Saved tab"
          onPress={onOpenSaved}
        />
      </ScreenScroll>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </>
  );
}
