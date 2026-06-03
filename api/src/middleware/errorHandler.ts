import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// Safe, explicitly-typed shape for fields echoed to the client alongside an
// error. Constrained to non-sensitive quota figures so a future caller cannot
// accidentally leak canyon names/coords (CLAUDE.md privacy rule) — adding a new
// key here is a deliberate, reviewable change, not an open-ended spread.
export interface AppErrorDetails {
  used?: number | string;
  quota?: number | string;
  resetAt?: string;
}

export class AppError extends Error {
  public details?: AppErrorDetails;
  constructor(
    public statusCode: number,
    message: string,
    details?: AppErrorDetails,
  ) {
    super(message);
    this.name = "AppError";
    this.details = details;
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  const reqId = (req as Request & { id?: string }).id;
  const reqLog =
    (req as Request & { log?: typeof logger }).log ?? logger;

  if (err instanceof AppError) {
    reqLog.warn({ err, statusCode: err.statusCode, reqId }, "request_failed");
    // Echo only whitelisted detail keys — never blind-spread err.details.
    const body: Record<string, unknown> = {
      error: err.message,
      requestId: reqId,
    };
    if (err.details) {
      if (err.details.used !== undefined) body.used = err.details.used;
      if (err.details.quota !== undefined) body.quota = err.details.quota;
      if (err.details.resetAt !== undefined) body.resetAt = err.details.resetAt;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  reqLog.error({ err, reqId }, "unhandled_error");
  res
    .status(500)
    .json({ error: "Internal server error", requestId: reqId });
}
