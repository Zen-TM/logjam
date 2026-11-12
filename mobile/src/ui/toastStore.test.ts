import { describe, expect, it, vi } from "vitest";

import { createToastQueue, type Entry } from "./toastStore";

const entry = (
  text: string,
  over: Partial<Entry> & { tone?: "done" | "error" } = {},
): Entry => ({
  owner: Symbol("screen"),
  message: {
    text,
    tone: over.tone ?? "done",
    nonce: 1,
    action: over.message?.action,
  },
  onDismissed: vi.fn(),
  ...over,
});

describe("the toast queue", () => {
  // Mutation: make publish overwrite `current` (the old single slot), and the
  // first toast, an error here, is gone before it is read.
  it("shows one at a time and the rest in the order they came", () => {
    const queue = createToastQueue();
    const [a, b, c] = [entry("a", { tone: "error" }), entry("b"), entry("c")];
    for (const each of [a, b, c]) queue.publish(each);
    expect(queue.current()).toBe(a);
    queue.dismiss();
    expect(queue.current()).toBe(b);
    queue.dismiss();
    expect(queue.current()).toBe(c);
    queue.dismiss();
    expect(queue.current()).toBeNull();
  });

  // Mutation: skip `ended.onDismissed()`, and the raising screen's message
  // state stays set (its next identical toast never re-publishes).
  it("runs every toast's onDismissed, as it ends", () => {
    const queue = createToastQueue();
    const [a, b] = [entry("a"), entry("b")];
    queue.publish(a);
    queue.publish(b);
    expect(a.onDismissed).not.toHaveBeenCalled();
    queue.dismiss();
    expect(a.onDismissed).toHaveBeenCalledTimes(1);
    expect(b.onDismissed).not.toHaveBeenCalled();
    queue.dismiss();
    expect(b.onDismissed).toHaveBeenCalledTimes(1);
  });

  // Mutation: drop the dedupe, and a repeated tap queues the same sentence
  // five times. Mutation: compare nonces, and it does the same.
  it("does not add a toast that is already showing or waiting", () => {
    const queue = createToastQueue();
    const screen = Symbol("screen");
    queue.publish(entry("saved", { owner: screen }));
    queue.publish(entry("other"));
    const again = entry("saved", { owner: screen });
    const alsoWaiting = entry("other", { owner: screen });
    queue.publish(again);
    queue.publish(alsoWaiting);
    expect(queue.queued()).toBe(1);
    // The same screen's copy is not dismissed: its state is the showing one's.
    expect(again.onDismissed).not.toHaveBeenCalled();
  });

  // Mutation: return without calling it, and a second screen's state holds a
  // message nobody will ever show.
  it("dismisses another screen's copy of a message at once", () => {
    const queue = createToastQueue();
    queue.publish(entry("Synced"));
    const copy = entry("Synced");
    queue.publish(copy);
    expect(copy.onDismissed).toHaveBeenCalledTimes(1);
    expect(queue.queued()).toBe(0);
  });

  // Mutation: compare text alone, and "Deleted" with Undo is dropped behind
  // a plain "Deleted".
  it("keeps the same words with a different tone or action", () => {
    const queue = createToastQueue();
    queue.publish(entry("Deleted"));
    queue.publish(entry("Deleted", { tone: "error" }));
    queue.publish(
      entry("Deleted", {
        message: {
          text: "Deleted",
          tone: "done",
          nonce: 2,
          action: { label: "Undo", onPress: () => {} },
        },
      }),
    );
    expect(queue.queued()).toBe(2);
  });

  // Mutation: have publish unpublish when its screen unmounts (a cleanup that
  // removes the owner's entries), and an outcome raised just before navigating
  // away never shows. Nothing in the queue knows a screen is gone.
  it("still shows, then dismisses, a toast whose screen has gone", () => {
    const queue = createToastQueue();
    const gone = entry("Deleted");
    queue.publish(gone);
    queue.dismiss();
    expect(gone.onDismissed).toHaveBeenCalledTimes(1);
  });

  it("ignores a dismiss with nothing showing", () => {
    expect(() => createToastQueue().dismiss()).not.toThrow();
  });

  it("tells the toast when a host is mounted", () => {
    const queue = createToastQueue();
    expect(queue.hosted()).toBe(false);
    const unmount = queue.mountHost();
    expect(queue.hosted()).toBe(true);
    unmount();
    expect(queue.hosted()).toBe(false);
  });

  // Mutation: make `topHost` the oldest mounted host (hosts[0]), and a toast
  // raised while a sheet is open is drawn by the shell's host, under the
  // sheet's native Modal where nobody sees it.
  it("hands the toast to the newest host, and back when it unmounts", () => {
    const queue = createToastQueue();
    const shell = Symbol("shell");
    const sheet = Symbol("sheet");
    const other = Symbol("other sheet");
    const unmountShell = queue.mountHost(shell);
    expect(queue.topHost()).toBe(shell);
    const unmountSheet = queue.mountHost(sheet);
    expect(queue.topHost()).toBe(sheet);
    // A sheet opened over a sheet, then closed out of order.
    const unmountOther = queue.mountHost(other);
    expect(queue.topHost()).toBe(other);
    unmountSheet();
    expect(queue.topHost()).toBe(other);
    unmountOther();
    expect(queue.topHost()).toBe(shell);
    unmountShell();
    expect(queue.topHost()).toBeNull();
    expect(queue.hosted()).toBe(false);
  });

  it("notifies subscribers when the top host changes", () => {
    const queue = createToastQueue();
    const heard = vi.fn();
    queue.subscribe(heard);
    const unmount = queue.mountHost();
    unmount();
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
