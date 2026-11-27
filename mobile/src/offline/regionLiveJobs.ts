// Whether the region download queue has a job queued, downloading or paused,
// apart from the queue: `regionDownloads.ts` reads it to know a saved area is
// still on its way (so the kept weather run stays), and must not import the
// queue and its React Native and NetInfo modules to do so. The queue writes it
// in `publish`. Guard: regionDownloadQueue.test.ts.
let live = false;

export const regionJobsLive = (): boolean => live;
export const setRegionJobsLive = (value: boolean): void => {
  live = value;
};
