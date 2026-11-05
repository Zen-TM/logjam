// The queue behind `ToastHost`, free of React Native so its order and dedupe
// are unit-tested (toastStore.test.ts). One toast shows at a time; the rest
// wait their turn, so a background "Synced" never wipes an error or a toast
// with an action before it is read.
import type { ToastMessage } from "./Toast";

export type Entry = {
  /** Who raised it: the same publisher repeating a showing message is ignored,
   *  another publisher's copy is dismissed at once. */
  owner: symbol;
  message: ToastMessage;
  /** The raising screen clears its own state; runs once, whenever it ends. */
  onDismissed: () => void;
};

/** Same words, tone and action: the same toast, whatever its nonce. */
const sameToast = (a: ToastMessage, b: ToastMessage) =>
  a.text === b.text && a.tone === b.tone && a.action?.label === b.action?.label;

export function createToastQueue() {
  let current: Entry | null = null;
  const waiting: Entry[] = [];
  // Mounted hosts, oldest first: the shell's, then any modal sheet open over it.
  const hosts: symbol[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    current: () => current,
    queued: () => waiting.length,
    /** A host is mounted: `<Toast>` hands over to it instead of drawing in place. */
    hosted: () => hosts.length > 0,
    /**
     * The one host that draws the showing toast: the newest mounted. A native
     * Modal (a bottom sheet) covers the shell's host, so the sheet mounts one
     * of its own, and the toast shows there for as long as the sheet is open.
     */
    topHost: () => hosts[hosts.length - 1] ?? null,
    mountHost(id: symbol = Symbol("host")) {
      hosts.push(id);
      emit();
      return () => {
        hosts.splice(hosts.indexOf(id), 1);
        emit();
      };
    },
    publish(entry: Entry) {
      const twin = [current, ...waiting].find(
        (held) => held && sameToast(held.message, entry.message),
      );
      if (twin) {
        // Already showing or waiting. The same screen's state clears with the
        // one it holds; another screen's copy has nothing left to say.
        if (twin.owner !== entry.owner) entry.onDismissed();
        return;
      }
      if (current) waiting.push(entry);
      else current = entry;
      emit();
    },
    /** The showing toast ended (timer, ×, swipe, its action): the next one shows. */
    dismiss() {
      const ended = current;
      if (!ended) return;
      current = waiting.shift() ?? null;
      emit();
      ended.onDismissed();
    },
  };
}
