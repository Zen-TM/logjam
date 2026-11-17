import { unavailableReasonText } from "../auth/capabilities";
import { t } from "@logjam/shared";

/**
 * What the "Save an offline map" row says under its title: what is missing,
 * and, with no connection to save over, why the row is dim.
 */
export function coverageSubtitle(
  online: boolean,
  basemapName: string | undefined,
): string {
  const missing = t`No offline map for this area`;
  return online
    ? basemapName
      ? `${missing} · ${basemapName}`
      : missing
    : `${missing} · ${unavailableReasonText("needs-connection")}`;
}
