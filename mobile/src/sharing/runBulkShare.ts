// RUNNING one bulk share, and reporting honestly on a partial one.
//
// THE TWO HALVES HAVE NOTHING IN COMMON BUT THE BUTTON THAT STARTED THEM.
// Granting 60 shares is one request that takes as long as any other request.
// Sending 8 copies is 8 presign/upload/confirm round trips over whatever signal
// a car park has, and any one of them can fail on its own. So this is not a
// call, it is a QUEUE with progress — and its result is a report, not a
// boolean.
//
// ORDER IS LOAD-BEARING: copies first, `bulkShare` last. Every confirm carries
// the `batchId` and stays silent, and the final call is what fires the ONE push
// per recipient — so the buzz arrives after the files it is announcing, not
// before. Reversing these two makes the recipient's phone ring for eight files
// that are still uploading.
//
// RETRY IS NOT SYMMETRIC, which is why failures are reported per file rather
// than as "try again". Re-running the share half is free — the server skips
// pairs that already exist. Re-running the copy half after 6 of 8 uploaded
// hands the recipient 6 duplicates, and there is no unsend. So a partial run
// names the files that did not go and leaves the user to send those.
//
// PRIVACY: filenames are user text and routinely name canyons. They reach the
// progress line and the failure report because a user cannot act on "2 files
// failed" without knowing which. Never logged — the catch below records the
// error, not the name.
import * as Crypto from "expo-crypto";

import { messageFromError } from "@logjam/shared";

import { bulkShare } from "../api/shares";
import { sendFileCopy } from "../api/fileSends";
// The shapes and every word of the report live in ./bulkShareTargets — this
// module reaches expo-crypto and the API client, and mobile's vitest cannot
// parse React Native's Flow sources, so anything worth testing has to sit on
// the other side of that line (the rule `tapTarget.ts` and `shareRowSubtitle
// .ts` already follow).
import type {
  BulkShareCandidate,
  BulkShareOutcome,
  BulkSharePlan,
  BulkShareProgress,
} from "./bulkShareTargets";

export async function runBulkShare({
  plan,
  recipientIds,
  onProgress,
}: {
  plan: BulkSharePlan<BulkShareCandidate>;
  recipientIds: string[];
  onProgress: (progress: BulkShareProgress) => void;
}): Promise<BulkShareOutcome> {
  // One id for the whole action, stamped on every notification it creates so
  // the recipient's inbox can collapse them into one expandable row.
  const batchId = Crypto.randomUUID();
  let copiesSent = 0;
  const copiesFailed: string[] = [];

  for (const [index, candidate] of plan.copies.entries()) {
    const sendCopy = candidate.sendCopy!;
    onProgress({
      phase: "copies",
      done: index,
      total: plan.copies.length,
      filename: sendCopy.filename,
    });
    let cleanup: (() => Promise<void>) | undefined;
    try {
      const file = await sendCopy.resolveFile();
      cleanup = file.cleanup;
      await sendFileCopy({
        fileUri: file.uri,
        filename: sendCopy.filename,
        sourceKind: sendCopy.sourceKind,
        recipientIds,
        batchId,
      });
      copiesSent += 1;
    } catch (err) {
      // ONE FILE'S FAILURE IS ONE FILE'S FAILURE. Aborting the run here would
      // strand the user mid-way with no way to tell which files went, and a
      // re-run would duplicate the ones that did.
      console.error(err);
      copiesFailed.push(sendCopy.filename);
    } finally {
      // The track scratch file goes whether the send worked or not, exactly as
      // the single-item send does; an import's stored original has no cleanup.
      await cleanup?.().catch(() => {});
    }
  }

  // Always called, even with no shares to grant: it is also what fires the one
  // push for the copies above (`copyCount` is how it knows to).
  let granted = 0;
  let alreadyShared = 0;
  let ineligible = 0;
  let shareError: string | null = null;
  if (plan.shares.length > 0 || copiesSent > 0) {
    onProgress({ phase: "shares" });
    try {
      const result = await bulkShare({
        items: plan.shares,
        recipientIds,
        batchId,
        copyCount: copiesSent,
      });
      granted = result.granted;
      alreadyShared = result.alreadyShared;
      ineligible = result.ineligible;
    } catch (err) {
      console.error(err);
      shareError = messageFromError(err, "Couldn't share those items.");
    }
  }

  return { granted, alreadyShared, ineligible, copiesSent, copiesFailed, shareError };
}
