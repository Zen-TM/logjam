// Settings → Regions: which regions' maps Logjam GPS offers. Heights and
// terrain show wherever the map is, whatever is chosen (shared/src/regions.ts).
//
// A guest chooses too, kept on the phone (ADR 0007). A linked account sends
// the choice, so it waits for a connection.
import { useCallback, useState } from "react";
import { Text } from "react-native";
import { REGION_CHOICE } from "@logjam/shared";

import { useAccountState } from "../../auth/AccountStateContext";
import {
  capabilityStatus,
  unavailableReasonText,
} from "../../auth/capabilities";
import { useConnectivity } from "../../map/connectivity";
import { chooseRegions, useRegions } from "../../regionsPreference";
import { makeStyles, muted } from "../../theme";
import { ScreenScroll, Toast, type ToastMessage } from "../../ui";
import { RegionSwitches } from "../RegionSwitches";

export function RegionsSettingsScreen() {
  const styles = useStyles();
  const chosen = useRegions();
  const { accountState } = useAccountState();
  const online = useConnectivity() === "online";
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // A guest is "needs-account" here and still allowed: nothing is sent.
  const status = capabilityStatus("serverPrefs", accountState, online);
  const offline =
    status.status === "unavailable" && status.reason === "needs-connection";

  const change = useCallback(
    async (next: string[]) => {
      if (await chooseRegions(next, accountState !== "guest")) return;
      setToast({
        text: REGION_CHOICE.saveFailed,
        tone: "error",
        nonce: Date.now(),
      });
    },
    [accountState],
  );

  return (
    <>
      <ScreenScroll>
        <Text style={styles.hint}>
          {offline
            ? unavailableReasonText("needs-connection")
            : REGION_CHOICE.hint}
        </Text>
        <RegionSwitches
          chosen={chosen}
          onChange={(next) => void change(next)}
          keepOne
          disabled={offline}
        />
      </ScreenScroll>
      <Toast message={toast} onDismissed={() => setToast(null)} />
    </>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  hint: { ...muted(theme, textRole.paragraph) },
}));
