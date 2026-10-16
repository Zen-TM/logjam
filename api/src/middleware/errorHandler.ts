import { Request, Response, NextFunction } from "express";
import { SERVER_FAULT_SENTENCE, withoutQuoted } from "@logjam/shared";
import { AppError, malformed } from "../lib/appError";
import { logger, redactTilePathPatterns, safeErrorForLog } from "../lib/logger";

// The class lives apart so that auth.ts can refuse a request without loading
// the logger, which reads the environment as it loads.
export {
  AppError,
  fault,
  malformed,
  type AppErrorDetails,
} from "../lib/appError";

export function errorHandler(
  thrown: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  // express.json's SyntaxError quotes the body it could not parse, which may
  // hold a place name the user typed: answer it as malformed, without the
  // message (placeSearch.unit.test.ts, "never logs the query").
  const err =
    (thrown as Error & { type?: string }).type === "entity.parse.failed"
      ? malformed("the request body is not valid JSON")
      : thrown;
  const reqId = (req as Request & { id?: string }).id;
  const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;

  if (err instanceof AppError) {
    // Never log the raw Error — its message/stack can embed user-supplied place
    // names/coords (e.g. a wrapped Prisma error). safeErrorForLog scrubs them;
    // pino's redact paths can't reach free text inside err.message/err.stack.
    // A sentence may quote the user's own words (a label, a type's name);
    // withoutQuoted takes them out (errorHandler.unit.test.ts).
    const safe = safeErrorForLog(err);
    const detail =
      err.devDetail === undefined
        ? undefined
        : redactTilePathPatterns(err.devDetail);
    reqLog.warn(
      {
        err: { ...safe, message: withoutQuoted(safe.message) },
        statusCode: err.statusCode,
        reqId,
        ...(detail !== undefined && { detail }),
      },
      "request_failed",
    );
    // Echo only whitelisted detail keys — never blind-spread err.details. Guard:
    // errorHandler.unit.test.ts.
    const body: Record<string, unknown> = {
      error: err.message,
      requestId: reqId,
    };
    if (err.sendDetail && detail !== undefined) body.detail = detail;
    if (err.details) {
      if (err.details.used !== undefined) body.used = err.details.used;
      if (err.details.quota !== undefined) body.quota = err.details.quota;
      if (err.details.resetAt !== undefined) body.resetAt = err.details.resetAt;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  reqLog.error({ err: safeErrorForLog(err), reqId }, "unhandled_error");
  res.status(500).json({ error: SERVER_FAULT_SENTENCE, requestId: reqId });
}
