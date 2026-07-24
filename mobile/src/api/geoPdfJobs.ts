// Server-generated GeoPDF jobs (the same ones the web "Generate GeoPDF" flow
// produces). Mobile does not generate them; it lists the user's completed jobs
// and imports their bytes into the on-device GeoPDF pipeline for offline use.
// Online-only: fetching the list + presigned download needs the network. The
// import artifact it produces is then device-local (see importGeoPdfFromUrl).
import type { GeoPdfJobView } from "@logjam/shared";

import { apiFetch } from "./apiFetch";

export type { GeoPdfJobView };

/** The user's GeoPDF jobs, newest first (server-capped). */
export function listGeoPdfJobs(): Promise<GeoPdfJobView[]> {
  return apiFetch<{ jobs: GeoPdfJobView[] }>("/geo-pdf").then((r) => r.jobs);
}

/**
 * Re-fetch one job — used to obtain a fresh presigned `downloadUrl` when the
 * one from the list has expired between load and import.
 */
export function getGeoPdfJob(id: string): Promise<GeoPdfJobView> {
  return apiFetch<GeoPdfJobView>(`/geo-pdf/${id}`);
}
