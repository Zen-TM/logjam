import type { Server } from "http";
import type { RequestHandler } from "express";
import { logger, safeErrorForLog } from "./logger";

interface ShutdownOptions {
  timeoutMs: number;
  /** Runs when shutdown begins, before the server stops listening. */
  stop: () => void;
  /** Runs once every connection has ended. */
  finish: () => Promise<void>;
  exit: (code: number) => void;
}

// `server.close()` waits for every open connection, and a client that keeps
// sending on a keep-alive one (CloudFront, a load generator) never lets it go
// idle: measured on a scratch copy, 2026-11-11, a release under 40 requests a
// second sat until Docker's 10 s kill. So once shutdown has begun every
// response says `Connection: close`, ending each connection with the request
// in flight on it. A request already in flight is answered, and only
// `timeoutMs` bounds one that never is. A response of several megabytes to a
// slow reader can still be cut: Node counts a socket idle once the response
// has ended, before its bytes are flushed, and `server.close()` alone does the
// same. Accepted here: the peer is always a buffering proxy (CloudFront)
// that reads at full speed. A request pipelined behind another on the same
// connection loses its response; nothing in front of the API pipelines.
// Guard: src/lib/shutdown.unit.test.ts.
export function createShutdown(opts: ShutdownOptions) {
  let shuttingDown = false;

  const closeConnections: RequestHandler = (_req, res, next) => {
    if (shuttingDown) res.set("Connection", "close");
    next();
  };

  function begin(server: Server, signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutdown_initiated");

    opts.stop();

    const force = setTimeout(() => {
      clearInterval(sweep);
      logger.error("shutdown_timeout_force_exit");
      opts.exit(1);
    }, opts.timeoutMs);
    force.unref();

    // A connection that was mid-request when shutdown began sent its response
    // before the header above applied, so it goes idle afterwards and
    // `server.close()` (which only drops connections idle at the call) would
    // wait out the keep-alive timeout for it.
    const sweep = setInterval(() => server.closeIdleConnections(), 100);
    sweep.unref();

    server.close(async (err) => {
      clearInterval(sweep);
      if (err)
        logger.error({ err: safeErrorForLog(err) }, "server_close_error");
      // The deadline covers `finish` too, so it is only called off once that
      // has returned: where `exit` does not end the process (a test), a
      // deadline left running would report a clean shutdown as a forced one.
      try {
        await opts.finish();
        clearTimeout(force);
        logger.info("shutdown_complete");
        opts.exit(0);
      } catch (finishErr) {
        clearTimeout(force);
        logger.error(
          { err: safeErrorForLog(finishErr) },
          "prisma_disconnect_error",
        );
        opts.exit(1);
      }
    });
  }

  return {
    closeConnections,
    begin,
    isShuttingDown: () => shuttingDown,
  };
}
