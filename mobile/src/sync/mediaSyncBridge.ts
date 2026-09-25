// Local-mutation → sync trigger bridge. Outbox / media enqueue paths call
// scheduleMutationSync() after writing an op; the sync engine registers the
// real debounced handler here. Inverting the edge this way keeps the engine
// out of the enqueue modules' static import graph (no require cycle).
let handler: (() => void) | null = null;

export function setMutationSyncHandler(fn: (() => void) | null): void {
  handler = fn;
}

export function scheduleMutationSync(): void {
  handler?.();
}
