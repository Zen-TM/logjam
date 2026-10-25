// Settings → Offline and storage: what this phone fetches without being asked,
// what it may spend mobile data on, and where the things it already holds are
// managed.
//
// The auto-download switches are DEVICE preferences (see
// `geopdf/autoDownloadPreference.ts`, `offline/topoAutoDownload.ts`): whether
// this handset should spend tens of megabytes and a couple of minutes of
// rasterising is a fact about the handset, not about the person, and as account
// preferences they would need a connection to change — which is the state you are
// most likely to be in when you want them off.
//
// The data switches are separate from the download switches on purpose. "Should
// this happen at all" and "may it happen on my mobile plan" are different
// questions, and folding them into one three-way control means a user who wants
// a GeoPDF the moment it is ready, but only on Wi-Fi, has nothing to pick.
//
// The storage row is a POINTER, not a duplicate. Saved is the inventory screen
// and owns the per-item actions (DESIGN.md — the three verbs follow the asset
// wherever it is listed); re-listing downloads here would be a second place for
// them to go stale.
//
// ONE ROW HERE IS ACCOUNT-SCOPED, and it is the exception the page states rather
// than hides: "Photos with copied places" lives on the user record
// (`uiPreferences.copyPlaceMedia`) because the SERVER reads it — it is the
// fallback when a copy request does not say, which is what lets Logjam Web
// honour a choice made here. It is on THIS page rather than a page of its own
// because what it decides is storage: whether a copied place's photos are
// duplicated into this account's quota. It carries the "Needs an account"
// treatment the notifications page states once, because unlike its neighbours
// it cannot be changed offline.
//
// A GUEST opens this page too: the place-names allowance and the Saved link are
// theirs. The rows that govern account-backed jobs are dead with "Needs an
// account" (`offlineRows.ts`), and the account query below stays off for them.
//
// PRIVACY: seven booleans. No place names, no regions named.
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

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
import { apiFetch } from "../../api/apiFetch";
import { fetchCurrentUser, useApiQuery } from "../../api/queries";
import { useAccountState } from "../../auth/AccountStateContext";
import {
  capabilityStatus,
  unavailableReasonText,
} from "../../auth/capabilities";
import { useConnectivity } from "../../map/connectivity";
import { offlineRowNeedsAccount, type OfflineRow } from "./offlineRows";
import type { TUser } from "../../api/types";
import { messageFromError } from "@logjam/shared";
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
  // No `needs`: there is no switch for it, only the file in Settings → Map.
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

  const [autoDownload, setAutoDownload] = useState(isAutoDownloadEnabled);
  const [topoAutoDownload, setTopoAutoDownload] = useState(
    isTopoAutoDownloadEnabled,
  );
  // One object rather than three booleans: the rows are data (METERED_ROWS), so
  // their state has to be indexable by the same key.
  const [metered, setMetered] = useState<Record<MeteredJob, boolean>>(() => ({
    geoPdfDownload: isMeteredAllowed("geoPdfDownload"),
    topoDownload: isMeteredAllowed("topoDownload"),
    placeNames: isMeteredAllowed("placeNames"),
    sync: isMeteredAllowed("sync"),
    mediaUpload: isMeteredAllowed("mediaUpload"),
  }));

  // ── The one account-scoped row (see the header) ──────────────────────────
  const { accountState } = useAccountState();
  const online = useConnectivity() === "online";
  const userQuery = useApiQuery(
    fetchCurrentUser,
    "Couldn't load your settings.",
    accountState !== "guest",
  );
  // Optimistic with rollback, and re-seeded on the VALUE rather than on the
  // user id — a preference changed on another device and pulled in by a
  // refetch while this screen stays mounted would otherwise be silently dropped.
  const [copyMedia, setCopyMedia] = useState<boolean | null>(null);
  const serverCopyMedia = userQuery.data
    ? (userQuery.data.uiPreferences?.copyPlaceMedia ?? true)
    : null;
  const [seededFor, setSeededFor] = useState<boolean | null>(null);
  if (serverCopyMedia !== seededFor) {
    setSeededFor(serverCopyMedia);
    if (serverCopyMedia !== null) setCopyMedia(serverCopyMedia);
  }

  const toggleCopyMedia = useCallback(() => {
    setCopyMedia((current) => {
      if (current === null) return current;
      const next = !current;
      apiFetch<TUser>("/users/me", {
        method: "PATCH",
        body: { copyPlaceMedia: next },
      }).catch((err: unknown) => {
        console.error(err);
        setCopyMedia(current);
        notify(messageFromError(err, "Couldn't save that setting."));
      });
      return next;
    });
  }, [notify]);

  const needsAccount = (row: OfflineRow) =>
    offlineRowNeedsAccount(row, accountState);
  const accountText = unavailableReasonText("needs-account");

  const serverPrefs = capabilityStatus("serverPrefs", accountState, online);
  const copyMediaBlocked: string | undefined =
    serverPrefs.status === "unavailable"
      ? unavailableReasonText(serverPrefs.reason)
      : userQuery.error
        ? "Couldn't reach your account"
        : undefined;

  return (
    <>
      <ScreenScroll>
        <SectionHeader title="Fetch automatically" />
        <PreferenceRow
          icon="geoPdf"
          title="Finished GeoPDFs"
          subtitle={
            needsAccount("autoGeoPdf")
              ? accountText
              : "GeoPDFs generated on Logjam Web download here automatically."
          }
          value={autoDownload}
          ready={!needsAccount("autoGeoPdf")}
          onToggle={() => {
            const next = !autoDownload;
            if (!stored(setAutoDownloadEnabled(next))) return;
            setAutoDownload(next);
          }}
        />
        <PreferenceRow
          icon="lidar"
          title="Finished sharpened areas"
          subtitle={
            needsAccount("autoTopo")
              ? accountText
              : "Sharpened areas made on Logjam Web download here automatically."
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
          const off =
            (row.needs === "geoPdf" && !autoDownload) ||
            (row.needs === "topo" && !topoAutoDownload);
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

        <SectionHeader title="When you save a copy" />
        {/* The default for the switch that appears on the copy sheet itself,
            which is where it is usually changed. Here so it can be found and
            so Logjam Web — which has no switch of its own — follows it too. */}
        <PreferenceRow
          icon="photo"
          title="Photos with copied places"
          subtitle={
            copyMediaBlocked ??
            "Copies a shared place's photos and files into your storage too."
          }
          subtitleNumberOfLines={2}
          value={copyMedia ?? true}
          ready={copyMediaBlocked === undefined && copyMedia !== null}
          onToggle={toggleCopyMedia}
        />

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
