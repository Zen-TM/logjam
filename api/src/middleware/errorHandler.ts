import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
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
    res.status(err.statusCode).json({ error: err.message, requestId: reqId });
    return;
  }

  reqLog.error({ err, reqId }, "unhandled_error");
  res
    .status(500)
    .json({ error: "Internal server error", requestId: reqId });
}
