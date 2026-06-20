import dotenv from "dotenv";
import path from "path";
// Local dev (run from api/ via `npm run dev`) loads the Terraform-generated root
// .env.local — the single source of dev env (infra/terraform/envs/local). In
// production NODE_ENV is already set by the EB/ECS container, so env comes from
// there and we skip the file (dotenv.config() is a harmless no-op if absent).
if (process.env.NODE_ENV === "production") {
  dotenv.config();
} else {
  dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
}

import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { getEnv } from "./lib/env";
import { logger } from "./lib/logger";
import prisma from "./services/prisma";
import { errorHandler } from "./middleware/errorHandler";
import { globalLimiter } from "./middleware/rateLimit";
import { startTopoJobReaper } from "./lib/topoJobReaper";
import usersRouter from "./routes/users";
import canyonsRouter from "./routes/canyons";
import tripLogsRouter from "./routes/tripLogs";
import tripLogsGlobalRouter from "./routes/tripLogsGlobal";
import tripLogsBulkRouter from "./routes/tripLogsBulk";
import canyonsBulkRouter from "./routes/canyonsBulk";
import sharingRouter from "./routes/sharing";
import friendsRouter from "./routes/friends";
import notificationsRouter from "./routes/notifications";
import ropewikiRouter from "./routes/ropewiki";
import topoJobsRouter from "./routes/topoJobs";
import mediaRouter from "./routes/media";
import topoExportsRouter from "./routes/topoExports";
import geoPdfTemplatesRouter from "./routes/geoPdfTemplates";
import topoTemplatesRouter from "./routes/topoTemplates";
import vectorStyleRouter from "./routes/vectorStyle";
import geoPdfRouter from "./routes/geoPdf";
import analyticsRouter from "./routes/analytics";
import importsRouter from "./routes/imports";

const env = getEnv();

const app = express();

let shuttingDown = false;

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming =
        (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
      res.setHeader("X-Request-Id", incoming);
      return incoming;
    },
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        // Deliberately omit body — payloads may contain canyon names/coords.
      }),
    },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin / curl requests have no Origin header — allow.
      if (!origin) return callback(null, true);
      if (env.CORS_ORIGIN_LIST.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Fake-Auth", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
    credentials: true,
  }),
);

app.use(
  helmet({
    // The API serves JSON and attachment-disposition PDFs only — never
    // inline-rendered HTML. A deny-all CSP is harmless for fetch() consumers
    // and closes the gap should any endpoint ever return renderable content.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // COEP deliberately disabled: it buys nothing for a JSON API and can
    // interfere with credentialed cross-origin embedding of responses.
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: false,
    },
  }),
);

app.use(express.json({ limit: "1mb" }));

// Liveness — cheap, never depends on DB
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Readiness — checks DB; 503 during shutdown or DB outage
app.get("/ready", async (_req, res) => {
  if (shuttingDown) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db_ping_timeout")), 1000),
      ),
    ]);
    res.json({ status: "ready" });
  } catch (err) {
    logger.warn({ err }, "ready_check_failed");
    res.status(503).json({ status: "db_unavailable" });
  }
});

// Global rate limit applied to API routes (not /health, /ready). Keyed by
// authenticated user sub when available (per-route auth runs inside routers),
// IP otherwise. Per-route stricter limiters layered inside individual routers.
app.use(globalLimiter);

app.use("/users", usersRouter);
app.use("/canyons", canyonsRouter);
app.use("/canyons/:canyonId/trips", tripLogsRouter);
app.use("/trips/bulk", tripLogsBulkRouter);
app.use("/canyons/bulk", canyonsBulkRouter);
app.use("/imports", importsRouter);
app.use("/trips", tripLogsGlobalRouter);
app.use("/canyons", sharingRouter);
app.use("/friends", friendsRouter);
app.use("/notifications", notificationsRouter);
app.use("/ropewiki", ropewikiRouter);
app.use("/topo-jobs", topoJobsRouter);
app.use("/media", mediaRouter);
app.use("/topo-exports", topoExportsRouter);
app.use("/geo-pdf-templates", geoPdfTemplatesRouter);
app.use("/topo-templates", topoTemplatesRouter);
app.use("/vector-style", vectorStyleRouter);
app.use("/geo-pdf", geoPdfRouter);
app.use("/analytics", analyticsRouter);

app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, "api_started");
});

// Periodic sweep that force-fails topo jobs stuck in pending/processing past a
// timeout (ARCH-002). No-op when TOPO_REAPER_INTERVAL_MS=0.
const stopTopoJobReaper = startTopoJobReaper();

const SHUTDOWN_TIMEOUT_MS = 25_000;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutdown_initiated");

  stopTopoJobReaper();

  const force = setTimeout(() => {
    logger.error("shutdown_timeout_force_exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  server.close(async (err) => {
    if (err) logger.error({ err }, "server_close_error");
    try {
      await prisma.$disconnect();
      logger.info("shutdown_complete");
      process.exit(0);
    } catch (disconnectErr) {
      logger.error({ err: disconnectErr }, "prisma_disconnect_error");
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled_rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught_exception");
  shutdown("uncaughtException");
});

export default app;
