import { unavailableReasonText } from "../auth/capabilities";

/**
 * What the "Save an offline map" row says under its title: what is missing,
 * and, with no connection to save over, why the row is dim.
 */
export function coverageSubtitle(
  online: boolean,
  basemapName: string | undefined,
): string {
  const missing = "No offline map for this area";
  return online
    ? basemapName
      ? `${missing} · ${basemapName}`
      : missing
    : `${missing} · ${unavailableReasonText("needs-connection")}`;
}
