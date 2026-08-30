// ANSWERING a whole batch of sent files at once — and reporting honestly when
// only some of it worked.
//
// "Accept all" is not a button, it is a QUEUE. Each accept presigns a URL,
// downloads the bytes and runs the same import a picked file goes through
// (`imports/acceptReceivedFile.ts`), so eight files is eight downloads and
// eight imports on whatever signal the recipient has — the exact mirror image
// of the sender's upload queue, and it needs the same treatment: progress while
// it runs, and a per-file account of what happened afterwards.
//
// WITHOUT THIS PAIR the bulk-share feature is only half built. Collapsing eight
// sends into one inbox row without giving that row a way to answer all eight
// moves the tedium rather than removing it: the recipient still opens eight
// rows and taps sixteen times.
//
// A FAILURE HERE IS RECOVERABLE, unlike the sending side. An accept that fails
// leaves the send acceptable — the row keeps its buttons and its own retry — so
// a partial run needs no special repair, only an honest sentence saying how far
// it got.
//
// Its own RN-free module, like every other decision in this directory, so the
// message logic has a test.
import type { TNotification } from "../api/types";

export type BatchFileActionKind = "accept" | "decline";

export type BatchFileActionProgress = { done: number; total: number };

export type BatchFileActionOutcome = {
  kind: BatchFileActionKind;
  done: number;
  failed: number;
  total: number;
};

/**
 * Run one answer over every pending member, in order, one at a time.
 *
 * SEQUENTIAL, not parallel. Each accept ends in an import, and the GeoPDF
 * pipeline is already a strict one-at-a-time queue (`runGeoPdfImport` is the
 * guard — two would fight over the single native rasteriser), so a parallel
 * fan-out would only queue behind itself while multiplying the peak memory of
 * the downloads in front of it.
 *
 * `run` is the caller's existing single-item path, so nothing here knows what
 * accepting a file involves — and the row's cache patching, its read state and
 * its already-answered-elsewhere handling stay in the one place that has them.
 */
export async function runBatchFileAction({
  items,
  run,
  onProgress,
}: {
  items: TNotification[];
  run: (notification: TNotification) => Promise<void>;
  onProgress: (progress: BatchFileActionProgress) => void;
}): Promise<{ done: number; failed: number; total: number }> {
  let done = 0;
  let failed = 0;
  for (const [index, notification] of items.entries()) {
    onProgress({ done: index, total: items.length });
    try {
      await run(notification);
      done += 1;
    } catch (err) {
      // ONE FILE'S FAILURE IS ONE FILE'S FAILURE. The rest of the batch is
      // still worth having, and the failed row keeps its own buttons.
      console.error(err);
      failed += 1;
    }
  }
  return { done, failed, total: items.length };
}

/**
 * What the toast says, and whether it is an error.
 *
 * A run where six of eight files landed is neither "saved" nor "failed", and
 * picking one of those two words tells the user something untrue about what is
 * now on their phone. The partial case reads as an ERROR because the part that
 * did not work is the part they have to do something about.
 */
export function batchFileActionMessage(
  outcome: BatchFileActionOutcome,
): { text: string; tone: "info" | "error" } {
  const { kind, done, failed, total } = outcome;
  if (done === 0) {
    return {
      text:
        kind === "accept"
          ? `Couldn't save ${countOf(total, "file")}.`
          : `Couldn't turn ${total === 1 ? "that down" : "those down"}.`,
      tone: "error",
    };
  }
  if (failed > 0) {
    return {
      text:
        kind === "accept"
          ? `Saved ${done} of ${total} — ${countOf(failed, "file")} couldn't be saved. Try those again from the list.`
          : `Turned down ${done} of ${total} — ${failed} couldn't be.`,
      tone: "error",
    };
  }
  return {
    text:
      kind === "accept"
        ? `Saved ${countOf(done, "file")} — find ${done === 1 ? "it" : "them"} in Saved.`
        : `Turned down ${countOf(done, "file")}.`,
    tone: "info",
  };
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
