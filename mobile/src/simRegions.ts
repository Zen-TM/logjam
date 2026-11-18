// Turns the simulated regions of shared/src/simRegions.ts on when
// EXPO_PUBLIC_SIM_REGIONS=1. `@logjam/shared` reads the switch once, when it
// loads, so index.ts imports this before anything else but the polyfills. A
// build aimed at a real API refuses it, so a stray setting cannot put regions
// with no data in a release. Guard: simRegions.test.ts.
import { isLocalApi } from "./authMode";

/** Whether the switch is on; throws where it must not be. */
export function simRegionsFor(
  flag: string | undefined,
  apiUrl: string | undefined,
): boolean {
  if (flag !== "1") return false;
  if (!apiUrl || !isLocalApi(apiUrl)) {
    throw new Error("Simulated regions are only allowed against a local API");
  }
  return true;
}

if (
  simRegionsFor(
    process.env.EXPO_PUBLIC_SIM_REGIONS,
    process.env.EXPO_PUBLIC_API_URL,
  )
) {
  (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
}
