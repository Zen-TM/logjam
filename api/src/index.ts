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
import { randomUUID, timingSafeEqual } from "crypto";
import { getEnv } from "./lib/env";
import { logger, safeErrorForLog, serializeRequestForLog } from "./lib/logger";
import prisma from "./services/prisma";
import { AppError, errorHandler } from "./middleware/errorHandler";
import { globalLimiter } from "./middleware/rateLimit";
import { startTopoJobReaper } from "./lib/topoJobReaper";
import usersRouter from "./routes/users";
import canyonsRouter from "./routes/canyons";
import tripLogsRouter from "./routes/tripLogs";
import tripLogsGlobalRouter from "./routes/tripLogsGlobal";
import tripLogsBulkRouter from "./routes/tripLogsBulk";
import canyonsBulkRouter from "./routes/canyonsBulk";
import sharingRouter from "./routes/sharing";
import sharesRouter from "./routes/shares";
import bulkShareRouter from "./routes/bulkShare";
import fileSendsRouter from "./routes/fileSends";
import friendsRouter from "./routes/friends";
import notificationsRouter from "./routes/notifications";
import ropewikiRouter from "./routes/ropewiki";
import topoJobsRouter from "./routes/topoJobs";
import mediaRouter from "./routes/media";
import topoExportsRouter from "./routes/topoExports";
import computeEstimateRouter from "./routes/computeEstimate";
import geoPdfTemplatesRouter from "./routes/geoPdfTemplates";
import topoTemplatesRouter from "./routes/topoTemplates";
import vectorStyleRouter from "./routes/vectorStyle";
import geoPdfRouter from "./routes/geoPdf";
import analyticsRouter from "./routes/analytics";
import customFieldsRouter from "./routes/customFields";
import importsRouter from "./routes/imports";
import metaRouter from "./routes/meta";
import devicesRouter from "./routes/devices";
import basemapRouter from "./routes/basemap";
import waypointsRouter from "./routes/waypoints";
import routesRouter from "./routes/routes";
import elevationRouter from "./routes/elevation";
import syncRouter from "./routes/sync";

const env = getEnv();

const app = express();

// Behind CloudFront -> EB nginx (2 hops). Trust exactly those so `req.ip` is the
// real client for the IP-fallback rate-limit key (middleware/rateLimit.ts) and
// request logs — NOT `true`, which would let clients spoof X-Forwarded-For and
// forge their rate-limit bucket. Hop count must match the live proxy chain; if
// the topology changes (e.g. an ALB is added), bump this. express-rate-limit's
// validator fails loud on a wrong count.
app.set("trust proxy", 2);

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
      // Path-only URL + no body: see serializeRequestForLog in lib/logger.
      req: serializeRequestForLog,
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
    allowedHeaders: ["Content-Type", "Authorization", "X-Fake-Sub", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "X-Total-Count"],
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
    logger.warn({ err: safeErrorForLog(err) }, "ready_check_failed");
    res.status(503).json({ status: "db_unavailable" });
  }
});

// CloudFront origin-verify (WAF-bypass guard). The EB environment CNAME is
// reachable on the public internet, so a client that knows it can hit the API
// while skipping the CloudFront edge WAF. CloudFront injects a secret
// X-Origin-Verify header on every origin fetch (infra/.../origin_verify.tf); a
// request whose header doesn't match reached EB directly. /health + /ready are
// exempt — EB health checks hit the instance directly and carry no header.
// Inert unless a secret is configured. ORIGIN_VERIFY_ENFORCE=false (default)
// LOGS the anomaly without blocking so the CloudFront header rollout is
// confirmable before enforcement; =true returns 403. Mounted before the rate
// limiter so direct-to-EB floods are rejected without consuming a limiter slot.
if (env.ORIGIN_VERIFY_SECRET) {
  const originVerifySecret = Buffer.from(env.ORIGIN_VERIFY_SECRET);
  app.use((req, _res, next) => {
    if (req.path === "/health" || req.path === "/ready") return next();
    const header = req.get("X-Origin-Verify");
    // Constant-time compare; length-mismatch short-circuits (timingSafeEqual
    // throws on unequal lengths, and the length itself is not the secret).
    const provided = header ? Buffer.from(header) : null;
    const matches =
      provided !== null &&
      provided.length === originVerifySecret.length &&
      timingSafeEqual(provided, originVerifySecret);
    if (matches) return next();
    if (env.ORIGIN_VERIFY_ENFORCE) {
      throw new AppError(403, "Forbidden");
    }
    logger.warn(
      { path: req.path, hasHeader: Boolean(header) },
      "origin_verify_mismatch",
    );
    next();
  });
}

// Global rate limit applied to API routes (not /health, /ready). Keyed by
// authenticated user sub when available (per-route auth runs inside routers),
// IP otherwise. Per-route stricter limiters layered inside individual routers.
app.use(globalLimiter);

app.use("/meta", metaRouter);
app.use("/users", usersRouter);
app.use("/canyons", canyonsRouter);
app.use("/canyons/:canyonId/trips", tripLogsRouter);
app.use("/trips/bulk", tripLogsBulkRouter);
app.use("/canyons/bulk", canyonsBulkRouter);
app.use("/imports", importsRouter);
app.use("/trips", tripLogsGlobalRouter);
app.use("/canyons", sharingRouter);
app.use("/shares", sharesRouter);
// Its own path, NOT /shares/bulk: it also ends a bulk action made entirely of
// file copies, which grant no Share row at all, and mounting it under the
// direct-share router would say otherwise.
app.use("/bulk-share", bulkShareRouter);
app.use("/file-sends", fileSendsRouter);
app.use("/friends", friendsRouter);
app.use("/notifications", notificationsRouter);
app.use("/devices", devicesRouter);
app.use("/basemap", basemapRouter);
app.use("/ropewiki", ropewikiRouter);
app.use("/topo-jobs", topoJobsRouter);
app.use("/media", mediaRouter);
app.use("/topo-exports", topoExportsRouter);
app.use("/compute-estimate", computeEstimateRouter);
app.use("/geo-pdf-templates", geoPdfTemplatesRouter);
app.use("/topo-templates", topoTemplatesRouter);
app.use("/vector-style", vectorStyleRouter);
app.use("/geo-pdf", geoPdfRouter);
app.use("/analytics", analyticsRouter);
app.use("/custom-fields", customFieldsRouter);
app.use("/waypoints", waypointsRouter);
app.use("/routes", routesRouter);
app.use("/elevation", elevationRouter);
app.use("/sync", syncRouter);

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
    if (err) logger.error({ err: safeErrorForLog(err) }, "server_close_error");
    try {
      await prisma.$disconnect();
      logger.info("shutdown_complete");
      process.exit(0);
    } catch (disconnectErr) {
      logger.error({ err: safeErrorForLog(disconnectErr) }, "prisma_disconnect_error");
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: safeErrorForLog(reason) }, "unhandled_rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err: safeErrorForLog(err) }, "uncaught_exception");
  shutdown("uncaughtException");
});

export default app;
