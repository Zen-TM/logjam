// Serialised, UNPOISONABLE write queue for recorded track batches.
//
// Deliveries can arrive faster than a write completes, and two interleaved
// handlers would both read the same `lastTrackPoint` — so batches are chained.
// The chain used to be `chain = chain.then(write)` with no rejection handler,
// and `.then(onFulfilled)` on a REJECTED promise does not call the handler: the
// first failed write (locked DB, disk pressure, a `getOfflineDb()` failure)
// left the chain permanently rejected and every later batch was silently
// dropped without `write` ever being called, for the life of the process, while
// the foreground service, the notification and the HUD all still said
// "Recording" (MLIFE-001).
//
// So each link settles BOTH ways, and a run of failures is published as
// recording-health the HUD shows: a recorder that cannot write must not present
// as one that is writing.
//
// Native-free on purpose — the poisoning invariant is unit-testable here.

/** Consecutive failed batches before the recording is presented as unhealthy.
 *  One failure is a hiccup the next batch usually clears; three in a row is the
 *  storage failing, and the user is walking away from data they think is being
 *  recorded. */
export const FAILING_WRITE_THRESHOLD = 3;

let chain: Promise<void> = Promise.resolve();
let consecutiveFailures = 0;
const listeners = new Set<() => void>();

function setConsecutiveFailures(next: number): void {
  const wasFailing = isRecordingWriteFailing();
  consecutiveFailures = next;
  if (isRecordingWriteFailing() !== wasFailing) {
    for (const listener of listeners) listener();
  }
}

/**
 * Queue one batch write behind the previous one. Never rejects: a failed write
 * is recorded as health and the NEXT caller still starts from a settled chain.
 */
export function enqueueTrackWrite(write: () => Promise<void>): Promise<void> {
  chain = chain.then(write).then(
    () => setConsecutiveFailures(0),
    (error: unknown) => {
      // Static code only — never location payloads (privacy rules).
      const code = (error as { code?: string } | null)?.code;
      console.warn(`track-recording write failed: ${code ?? "unknown"}`);
      setConsecutiveFailures(consecutiveFailures + 1);
    },
  );
  return chain;
}

/** True while the recorder has failed to persist several batches in a row. */
export function isRecordingWriteFailing(): boolean {
  return consecutiveFailures >= FAILING_WRITE_THRESHOLD;
}

/** Clear the failure run — a new or resumed recording starts healthy. */
export function resetTrackWriteHealth(): void {
  setConsecutiveFailures(0);
}

/** Subscribe to health changes (useSyncExternalStore shape). */
export function onTrackWriteHealthChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
