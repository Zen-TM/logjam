import { GAUGES } from "@logjam/shared";
import { Notice } from "../../ui";

/** The one line for a layer that is on but could not load. It stays quiet
 *  while a mode banner holds the spot (shared/DESIGN.md: one place talks). */
export function GaugeLoadNotice({
  failed,
  modeActive,
  className,
}: {
  failed: boolean;
  modeActive: boolean;
  className?: string;
}) {
  if (!failed || modeActive) return null;
  return (
    <div className={className}>
      <Notice>{GAUGES.copy.failed}</Notice>
    </div>
  );
}
