// Whether the region download queue has a job queued, downloading or paused,
// kept apart from the queue so `regionDownloads.ts` can read it (to know a
// saved area is still on its way, and keep the weather run) without importing
// the queue, which would bring NetInfo and the download service with it. The
// queue writes it in `publish`. Guard: regionDownloadQueue.test.ts, for
// `publish` writing the flag.
let live = false;

export const regionJobsLive = (): boolean => live;
export const setRegionJobsLive = (value: boolean): void => {
  live = value;
};
