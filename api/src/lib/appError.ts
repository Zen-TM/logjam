import {
  MALFORMED_REQUEST_SENTENCE,
  SERVER_FAULT_SENTENCE,
  type UserSentence,
} from "@logjam/shared";

// Safe, explicitly-typed shape for fields echoed to the client alongside an
// error. Constrained to non-sensitive quota figures so a future caller cannot
// accidentally leak place names/coords (root AGENTS.md, Privacy) — adding a new
// key here is a deliberate, reviewable change, not an open-ended spread.
export interface AppErrorDetails {
  used?: number | string;
  quota?: number | string;
  resetAt?: string;
}

/**
 * A refusal. `message` is what the user reads, on both clients, as it is:
 * write it with say`…` (`api/src/userCopy.unit.test.ts` checks every one).
 * `devDetail` is for whoever debugs it: logged, never shown.
 */
export class AppError extends Error {
  declare message: UserSentence;
  public details?: AppErrorDetails;
  /** Whether `devDetail` also goes back in the response, as `detail`. */
  public sendDetail = false;
  constructor(
    public statusCode: number,
    message: UserSentence,
    details?: AppErrorDetails,
    /** What went wrong, in a developer's words: the shape of the request or
     *  the state of the system, never a value from it (it is logged). */
    public devDetail?: string,
  ) {
    super(message);
    this.name = "AppError";
    this.details = details;
  }
}

// A plain string is not a sentence for the user. Mutation that fails the
// build here: widen the constructor's `message` back to `string`.
type _AppErrorTakesOnlySentences<
  T extends true = string extends ConstructorParameters<typeof AppError>[1]
    ? false
    : true,
> = T;

/**
 * A request only a bug in a client, or a hand-made request, can send. The user
 * gets one generic sentence; `detail` says what was wrong with the request's
 * shape, in the log and in the response's `detail`, which no client renders.
 */
export function malformed(detail: string, statusCode = 400): AppError {
  const err = new AppError(
    statusCode,
    MALFORMED_REQUEST_SENTENCE,
    undefined,
    detail,
  );
  err.sendDetail = true;
  return err;
}

/** A state of ours that should be impossible. The detail is logged only. */
export function fault(detail: string, statusCode = 500): AppError {
  return new AppError(statusCode, SERVER_FAULT_SENTENCE, undefined, detail);
}
