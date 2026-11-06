// Settings → Offline and storage: what this phone fetches without being asked,
// what it may spend mobile data on, and where the things it already holds are
// managed.
//
// The auto-download switch is a DEVICE preference (see
// `offline/topoAutoDownload.ts`): whether
// this handset should spend tens of megabytes and a couple of minutes of
// rasterising is a fact about the handset, not about the person, and as account
// preferences they would need a connection to change — which is the state you are
// most likely to be in when you want them off.
//
// The data switches are separate from the download switches on purpose. "Should
// this happen at all" and "may it happen on my mobile plan" are different
// questions, and folding them into one three-way control means a user who wants
// a topo the moment it is ready, but only on Wi-Fi, has nothing to pick.
//
// The storage row is a POINTER, not a duplicate. Saved is the inventory screen
// and owns the per-item actions (DESIGN.md — the three verbs follow the asset
// wherever it is listed); re-listing downloads here would be a second place for
// them to go stale.
//
// A GUEST opens this page too: the place-names allowance and the Saved link are
// theirs. The rows that govern account-backed jobs are dead with "Needs an
// account" (`offlineRows.ts`).
//
// PRIVACY: five booleans. No place names, no regions named.
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  isMeteredAllowed,
  setMeteredAllowed,
  type MeteredJob,
} from "../../offline/networkPolicy";
import {
  isTopoAutoDownloadEnabled,
  setTopoAutoDownloadEnabled,
} from "../../offline/topoAutoDownload";
import { useAccountState } from "../../auth/AccountStateContext";
import { unavailableReasonText } from "../../auth/capabilities";
import { offlineRowNeedsAccount, type OfflineRow } from "./offlineRows";
import {
  Row,
  ScreenScroll,
  SectionHeader,
  Toast,
  type ToastMessage,
} from "../../ui";
import { Hint, PreferenceRow } from "./settingsKit";
import { spacing } from "../../theme";
import { PLACE_REGISTRY_DOWNLOAD_ESTIMATE } from "../../offline/placeRegistry";

/**
 * `needs` names the auto-download switch a row is meaningless without: a data
 * allowance for work that isn't happening governs nothing, so those rows go
 * dead with the reason in place of their subtitle (DESIGN.md). Sync has no
 * such switch — it always runs — so it has none.
 */
const METERED_ROWS: {
  job: MeteredJob;
  title: string;
  subtitle: string;
  needs?: "topo";
}[] = [
  {
    job: "topoDownload",
    title: "LiDAR map auto-downloads",
    subtitle: "Tens of megabytes each.",
    needs: "topo",
  },
  // No `needs`: there is no switch for it, only the file the first region brings.
  {
    job: "placeNames",
    title: "Place names for search",
    subtitle: `${PLACE_REGISTRY_DOWNLOAD_ESTIMATE} a month.`,
  },
  {
    job: "sync",
    title: "Syncing trips and places",
    subtitle: "Usually a few kilobytes.",
  },
  // Media PUTs (up to 30 MB an image, 500 MB a video) have their own allowance
  // distinct from the sync allowance above (which is sized for a few kilobytes
  // of JSON). No `needs`: an attach isn't gated by either auto-download
  // switch — it happens whenever the user attaches something.
  {
    job: "mediaUpload",
    title: "Uploading photos and videos",
    subtitle: "Up to 500 MB per video.",
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

  const [topoAutoDownload, setTopoAutoDownload] = useState(
    isTopoAutoDownloadEnabled,
  );
  // One object rather than five booleans: the rows are data (METERED_ROWS), so
  // their state has to be indexable by the same key.
  const [metered, setMetered] = useState<Record<MeteredJob, boolean>>(() => ({
    topoDownload: isMeteredAllowed("topoDownload"),
    placeNames: isMeteredAllowed("placeNames"),
    sync: isMeteredAllowed("sync"),
    mediaUpload: isMeteredAllowed("mediaUpload"),
  }));

  const { accountState } = useAccountState();

  const needsAccount = (row: OfflineRow) =>
    offlineRowNeedsAccount(row, accountState);
  const accountText = unavailableReasonText("needs-account");

  return (
    <>
      <ScreenScroll>
        <SectionHeader title="Fetch automatically" />
        <PreferenceRow
          title="Sharpened areas"
          subtitle={
            needsAccount("autoTopo")
              ? accountText
              : "When finished on Logjam Web."
          }
          value={topoAutoDownload}
          ready={!needsAccount("autoTopo")}
          onToggle={() => {
            const next = !topoAutoDownload;
            if (!stored(setTopoAutoDownloadEnabled(next))) return;
            setTopoAutoDownload(next);
          }}
        />

        <SectionHeader title="Allow on mobile data" />
        {METERED_ROWS.map((row) => {
          const blocked = needsAccount(row.job);
          const off = row.needs === "topo" && !topoAutoDownload;
          return (
            <PreferenceRow
              key={row.job}
              title={row.title}
              subtitle={
                blocked
                  ? accountText
                  : off
                    ? "Auto-download is off"
                    : row.subtitle
              }
              value={metered[row.job]}
              ready={!blocked && !off}
              onToggle={() => {
                const next = !metered[row.job];
                if (!stored(setMeteredAllowed(row.job, next))) return;
                setMetered((current) => ({ ...current, [row.job]: next }));
              }}
            />
          );
        })}

        <SectionHeader title="On this phone" />
        <Row
          icon="device"
          title="Maps, imports and tracks"
          subtitle="Managed on the Saved tab"
          onPress={onOpenSaved}
        />
        {/* The sync boundary, stated once, where someone goes LOOKING for it.
            The answer a user wants on the Saved tab is per item (which the cloud
            mark on a synced Saved row gives them), while the general rule
            belongs here.

            A FOOTNOTE, not a Row: a row on this page is a control, and three of
            the four above it are switches. Wrapping a statement of fact in the
            same card promises a tap that does nothing. */}
        <View style={styles.footnote}>
          <Hint
            text={
              accountState === "guest"
                ? "Places, routes, imports and recordings are only on this phone until you link an account."
                : "Places, routes, imports and recordings are backed up to your account. Maps you downloaded stay on this device."
            }
          />
        </View>
      </ScreenScroll>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  // Sets this one off from the row above, which it is a note about the page
  // for rather than a note about that row.
  footnote: { paddingTop: spacing(2), paddingBottom: spacing(1) },
});
