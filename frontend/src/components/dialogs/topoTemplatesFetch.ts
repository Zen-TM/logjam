import { apiFetch } from "../../canyonUtils";
import type { TopoTemplate } from "./TopoDialog";

// Module-level in-flight dedup for GET /topo-templates (TOPO-6).
//
// Two surfaces fetch the template list independently (LidarPanel on mount,
// TopoDialog on open), and React StrictMode double-invokes mount effects in
// dev — so opening the LiDAR panel and then the topo dialog fired the same
// GET up to 4×. Concurrent callers now share one request; the promise is
// cleared on settle so any later trigger (dialog re-open, save-refresh)
// still gets fresh data. Errors propagate to every caller — no caching of
// failures, no swallowing.
let inFlight: Promise<TopoTemplate[]> | null = null;

export function fetchTopoTemplates(): Promise<TopoTemplate[]> {
  if (!inFlight) {
    inFlight = apiFetch<TopoTemplate[]>("/topo-templates").finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
