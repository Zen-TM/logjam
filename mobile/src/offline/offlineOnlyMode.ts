// Whether the map's "Offline maps only" switch is on, for code that is not
// under the map screen. The screen owns the switch and writes it here; in
// memory only, as the switch itself is.
let offlineOnly = false;

export function setOfflineOnly(on: boolean): void {
  offlineOnly = on;
}

export function isOfflineOnly(): boolean {
  return offlineOnly;
}
