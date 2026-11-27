// The wipe epoch, apart from the storage that uses it: the download queue
// reads it before it awaits the keep's module, and must not load the file
// system to do so.
let epoch = 0;

/** Read when a download begins; check it before every write. */
export const weatherMapEpoch = (): number => epoch;

/** A wipe: every download begun before now must stop writing. */
export function bumpWeatherMapEpoch(): void {
  epoch += 1;
}
