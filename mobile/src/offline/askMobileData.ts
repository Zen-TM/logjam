import NetInfo from "@react-native-community/netinfo";

import { confirm } from "../ui";
import { isExpensive } from "./networkPolicy";
import { t } from "@logjam/shared";

/**
 * Whether this download may use mobile data, asked here at the tap rather than
 * from a subscription's last value: the answer decides whether tens of
 * megabytes go on someone's plan, and the connection can change between the
 * last event and the tap. On Wi-Fi it answers `false` unasked (Wi-Fi only
 * restricts nothing there); on a metered link it asks once, about THIS
 * download, and `null` is a cancel, not a setting to go and find.
 */
export async function askAllowCellular(): Promise<boolean | null> {
  if (!isExpensive(await NetInfo.fetch())) return false;
  const allowed = await confirm({
    confirmTitle: t`Use mobile data?`,
    confirmBody: t`This download will use your mobile data.`,
    confirmLabel: t`Download`,
    tone: "filled",
  });
  return allowed ? true : null;
}
