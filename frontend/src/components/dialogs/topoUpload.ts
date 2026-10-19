// Sends a LiDAR ZIP to its topo job as an S3 multipart upload: parts go
// straight to S3, a few at a time, each retrying on its own, and a submit
// after a failure sends only the parts S3 does not hold yet, to the same job.
// Kept out of TopoDialog so the dialog can be rebuilt around it.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TOPO_UPLOAD_PART_URL_TTL_SECONDS,
  TOPO_UPLOAD_SIGN_MAX,
} from "@logjam/shared";
import { ApiError } from "../../errors/ApiError";
import { messageFromError } from "../../errors/messageFromError";
import { apiFetch, putToPresignedUrl } from "../../placeUtils";

const CONCURRENCY = 4;
const ATTEMPTS = 5;
/** A part that sends no bytes for this long is dropped and retried. */
const STALL_MS = 60_000;
// Re-sign five minutes before a part URL expires.
const URL_FRESH_MS = (TOPO_UPLOAD_PART_URL_TTL_SECONDS - 5 * 60) * 1000;
const SIGN_BATCH = Math.min(16, TOPO_UPLOAD_SIGN_MAX);

/** One ZIP on its way to one job. */
export type TopoUploadSession = {
  file: File;
  jobId: string;
  uploadId: string;
  partSize: number;
  /** Parts S3 has acknowledged. */
  done: Set<number>;
  /** The parts are joined; only /start is left. */
  completed: boolean;
};

export type TopoJobRequest = {
  tileCount: number | null;
  jobName: string | null;
  filename: string;
  settings: unknown;
  autoExport: unknown;
};

/** Sends every part not yet in `session.done`, then joins them. Rejects with
 *  the first part that failed every attempt; the parts that made it stay in
 *  `session.done` for the next call. */
export async function sendTopoParts(
  session: TopoUploadSession,
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  const { file, partSize } = session;
  const partCount = Math.max(1, Math.ceil(file.size / partSize));
  const sizeOf = (n: number) =>
    Math.min(partSize, file.size - (n - 1) * partSize);
  const queue = Array.from({ length: partCount }, (_, i) => i + 1).filter(
    (n) => !session.done.has(n),
  );
  const sending = new Map<number, number>();
  const report = () => {
    let sent = 0;
    for (const n of session.done) sent += sizeOf(n);
    for (const bytes of sending.values()) sent += bytes;
    onProgress(sent, file.size);
  };

  // Part URLs are signed in batches, one batch in flight at a time, so four
  // parts starting together cost one request rather than four.
  const urls = new Map<number, { url: string; at: number }>();
  let signing: Promise<void> | null = null;
  async function sign(partNumbers: number[]) {
    const { parts } = await apiFetch<{
      parts: { partNumber: number; url: string }[];
    }>(`/topo-jobs/${session.jobId}/parts`, {
      method: "POST",
      body: { uploadId: session.uploadId, sizeBytes: file.size, partNumbers },
    });
    const at = Date.now();
    for (const p of parts) urls.set(p.partNumber, { url: p.url, at });
  }
  async function urlFor(n: number): Promise<string> {
    for (;;) {
      const hit = urls.get(n);
      if (hit && Date.now() - hit.at < URL_FRESH_MS) return hit.url;
      signing ??= sign([n, ...queue.slice(0, SIGN_BATCH - 1)]).finally(() => {
        signing = null;
      });
      await signing;
    }
  }

  const failures: unknown[] = [];
  async function sendPart(n: number) {
    const start = (n - 1) * partSize;
    const body = file.slice(start, start + partSize);
    for (let attempt = 1; ; attempt++) {
      try {
        const url = await urlFor(n);
        await putToPresignedUrl(
          url,
          body,
          null,
          (loaded) => {
            sending.set(n, loaded);
            report();
          },
          STALL_MS,
        );
        return;
      } catch (error) {
        // An expired URL fails like any other attempt; sign afresh.
        urls.delete(n);
        sending.delete(n);
        if (attempt >= ATTEMPTS || failures.length || isRefusal(error))
          throw error;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  async function worker() {
    while (!failures.length && queue.length) {
      const n = queue.shift()!;
      try {
        await sendPart(n);
        session.done.add(n);
      } catch (error) {
        failures.push(error);
      }
      sending.delete(n);
      report();
    }
  }
  report();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failures.length) throw failures[0];

  await apiFetch(`/topo-jobs/${session.jobId}/complete`, {
    method: "POST",
    body: { uploadId: session.uploadId, partCount },
  });
  session.completed = true;
}

export const UPLOAD_STOPPED =
  "The upload stopped. Check your connection, then choose Make it again to carry on from where it stopped.";

/** What to tell the user when `submit` failed, before or after the ZIP was
 *  all `uploaded`. A dropped connection carries no server sentence, and the
 *  generic "try again" would send them back to the ZIP, losing the parts sent. */
export function submitFailureMessage(error: unknown, uploaded: boolean) {
  if (!uploaded && !(error instanceof ApiError)) return UPLOAD_STOPPED;
  return messageFromError(
    error,
    uploaded ? "Submission failed. Please try again." : UPLOAD_STOPPED,
  );
}

/** The API turned the request down, and asking again won't change that. Only
 *  `sign` throws ApiError; 429 is the rate limiter, which waiting does change. */
const isRefusal = (error: unknown) =>
  error instanceof ApiError && error.status < 500 && error.status !== 429;

/** Makes a topo job from a ZIP. `submit` again after a failure carries on
 *  with the same job while the file is the same one; `discard` deletes a job
 *  that never started (call it when the user gives up on the ZIP). `held`
 *  is true while a submit would carry on that job rather than make one. */
export function useTopoUpload() {
  const session = useRef<TopoUploadSession | null>(null);
  const [held, setHeld] = useState(false);
  const hold = useCallback((next: TopoUploadSession | null) => {
    session.current = next;
    setHeld(next !== null);
  }, []);

  const discard = useCallback(() => {
    const abandoned = session.current;
    hold(null);
    if (abandoned)
      apiFetch(`/topo-jobs/${abandoned.jobId}`, { method: "DELETE" }).catch(
        () => {},
      );
  }, [hold]);
  useEffect(() => discard, [discard]);

  const submit = useCallback(
    async (
      file: File,
      job: TopoJobRequest,
      on: {
        progress: (sent: number, total: number) => void;
        uploaded: () => void;
      },
    ): Promise<string> => {
      if (session.current?.file !== file) {
        discard();
        const created = await apiFetch<{
          jobId: string;
          uploadId: string;
          partSize: number;
        }>("/topo-jobs", { method: "POST", body: job });
        hold({
          file,
          jobId: created.jobId,
          uploadId: created.uploadId,
          partSize: created.partSize,
          done: new Set(),
          completed: false,
        });
      }
      const current = session.current!;
      if (!current.completed) {
        try {
          await sendTopoParts(current, on.progress);
        } catch (e) {
          // The job is gone (deleted, or swept after 24 h) or has left
          // `uploading`: carrying on can't succeed, so the next submit makes
          // a new one.
          if (e instanceof ApiError && (e.status === 404 || e.status === 400))
            hold(null);
          throw e;
        }
      }
      on.uploaded();
      try {
        await apiFetch(`/topo-jobs/${current.jobId}/start`, {
          method: "POST",
        });
      } catch (e) {
        // A failed /start says nothing of whether the job left `uploading`:
        // the response may be lost after the job launched, or a 5xx may come
        // before. The job's own status decides.
        const status = await apiFetch<{ status: string }>(
          `/topo-jobs/${current.jobId}`,
        ).then(
          (job) => job.status,
          () => null,
        );
        if (status === "pending" || status === "processing") {
          hold(null);
          return current.jobId;
        }
        // Still uploading: submit again carries on. Anything else (failed,
        // or unknown) starts anew.
        if (status !== "uploading") hold(null);
        throw e;
      }
      hold(null);
      return current.jobId;
    },
    [discard, hold],
  );

  return { submit, discard, held };
}
