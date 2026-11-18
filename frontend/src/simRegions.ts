// The first import of main.tsx. With VITE_SIM_REGIONS=1 it turns the simulated
// regions of shared/src/simRegions.ts on, and it must run before anything
// loads `@logjam/shared`, which reads the switch once, when it loads. A build
// that signs in through a real provider refuses it, so a stray setting cannot
// put regions with no data in prod. Guard: simRegions.test.ts.
//
// A Web Worker has its own global scope, which the page's setting does not
// reach, so the GeoPDF render and prefetch workers (geoPdf/worker.ts,
// geoPdf/prefetch.worker.ts) import this module first too. Guard:
// geoPdf/workerSimRegions.test.ts.

/** Whether the switch is on; throws where it must not be. */
export function simRegionsFor(
  flag: string | undefined,
  authMode: string | undefined,
): boolean {
  if (flag !== "1") return false;
  if (authMode !== "fake") {
    throw new Error("VITE_SIM_REGIONS=1 is only allowed with fake auth");
  }
  return true;
}

const authMode = import.meta.env.VITE_AUTH_MODE;
const sim = globalThis as { LOGJAM_SIM_REGIONS?: boolean };
if (simRegionsFor(import.meta.env.VITE_SIM_REGIONS, authMode)) {
  sim.LOGJAM_SIM_REGIONS = true;
} else if (authMode !== "fake") {
  // `@logjam/shared` honours the global in any build, so one set by the page
  // before this bundle loaded would turn the regions on without the build flag.
  // Guard: simRegions.test.ts ("clears a switch the page set before the bundle
  // loaded").
  delete sim.LOGJAM_SIM_REGIONS;
}
