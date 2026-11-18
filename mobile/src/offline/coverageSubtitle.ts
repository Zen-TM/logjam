import { t } from "@logjam/shared";
import { unavailableReasonText } from "../auth/capabilities";

/**
 * What the "Save an offline map" row says under its title: what is missing,
 * and, with no connection to save over, why the row is dim.
 */
export function coverageSubtitle(
  online: boolean,
  basemapName: string | undefined,
): string {
  if (!online) {
    const reason = unavailableReasonText("needs-connection");
    return t`No offline map for this area · ${reason}`;
  }
  return basemapName
    ? t`No offline map for this area · ${basemapName}`
    : t`No offline map for this area`;
}
