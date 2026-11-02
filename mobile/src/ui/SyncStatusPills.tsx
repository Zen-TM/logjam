// The offline / "N waiting to sync" pill pair, carried in the hero of every
// list screen (DESIGN.md).
//
// Carried by Places, Logs and Saved. **"3 waiting to sync" is a lie to a
// guest.** Nothing is waiting; there is no account for it to be waiting on, and
// the outbox rows behind that count are the permanent state of their data
// rather than a queue.
//
// The offline pill still shows for a guest: being offline is true regardless of
// whether an account exists, and it explains why the map is blank.
import { StyleSheet, View } from "react-native";

import { useAccountState } from "../auth/AccountStateContext";
import { useLastSyncAt } from "../sync/useSyncQueries";
import { spacing } from "../theme";
import { StatusPill } from "./StatusPill";
import { syncAgeLabel } from "./syncAge";

export function SyncStatusPills({
  online,
  pendingCount,
}: {
  online: boolean;
  /** Outbox rows not yet accepted by the server. */
  pendingCount: number;
}) {
  const isGuest = useAccountState().accountState === "guest";
  const showPending = pendingCount > 0 && !isGuest;
  const lastSyncAt = useLastSyncAt();
  // Only drawn offline, and a tab screen outlives the day it was opened on, so
  // the clock is read as the pill is drawn, not when the screen mounted.
  const age = online ? null : syncAgeLabel(lastSyncAt);

  if (online && !showPending) return null;
  return (
    <View style={styles.row}>
      {online ? null : (
        <StatusPill
          label={age ? `Offline · ${age}` : "Offline"}
          tone="muted"
          icon="offline"
        />
      )}
      {showPending ? (
        <StatusPill
          label={`${pendingCount} waiting to sync`}
          tone="outline"
          icon="uploading"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    flexWrap: "wrap",
  },
});
