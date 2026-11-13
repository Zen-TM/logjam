import { say } from "@logjam/shared";
import dotenv from "dotenv";
import path from "path";
// Local dev (run from api/ via `npm run dev`) loads the Terraform-generated root
// .env.local — the single source of dev env (infra/terraform/envs/local). In
// production NODE_ENV is already set by the container's environment, so env comes
// from there and we skip the file (dotenv.config() is a harmless no-op if absent).
if (process.env.NODE_ENV === "production") {
  dotenv.config();
} else {
  dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
}

import express, { type RequestHandler } from "express";
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
import { startPlaceRegistry } from "./services/placeRegistry";
import { ROUTER_MOUNTS } from "./routes/mounts";
import { createShutdown } from "./lib/shutdown";

const env = getEnv();

const app = express();

// Trust exactly TRUST_PROXY_HOPS proxies (1 in prod: CloudFront straight to
// the brain's container) so `req.ip` is the
// real client for the IP-fallback rate-limit key (middleware/rateLimit.ts) and
// request logs — NOT `true`, which would let clients spoof X-Forwarded-For and
// forge their rate-limit bucket. The count must match the live proxy chain; if
// the topology changes (e.g. an ALB is added), change it. express-rate-limit's
// validator fails loud on a wrong count. Guard: src/trustProxy.unit.test.ts.
app.set("trust proxy", env.TRUST_PROXY_HOPS);

const SHUTDOWN_TIMEOUT_MS = 25_000;

// Declared first so its header covers every route, errors and /ready included.
const lifecycle = createShutdown({
  timeoutMs: SHUTDOWN_TIMEOUT_MS,
  stop: () => {
    stopTopoJobReaper();
    stopPlaceRegistry();
  },
  finish: () => prisma.$disconnect(),
  exit: (code) => process.exit(code),
});
app.use(lifecycle.closeConnections);

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
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Fake-Sub",
      "X-Request-Id",
    ],
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
  if (lifecycle.isShuttingDown()) {
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

// CloudFront origin-verify (WAF-bypass guard). The brain's security group
// admits CloudFront's origin-facing addresses, which every CloudFront
// customer's distribution shares, so one that is not ours and points at the
// brain would reach the API while skipping our edge WAF. CloudFront injects a
// secret X-Origin-Verify header on every origin fetch
// (infra/.../origin_verify.tf); a request whose header doesn't match did not
// come through our distribution. /health + /ready are exempt — Compose's
// healthcheck calls the container directly and carries no header.
// Inert unless a secret is configured. ORIGIN_VERIFY_ENFORCE=false (default)
// LOGS the anomaly without blocking so the CloudFront header rollout is
// confirmable before enforcement; =true returns 403. Mounted before the rate
// limiter so floods that skip our distribution are rejected without consuming a
// limiter slot.
if (env.ORIGIN_VERIFY_SECRET) {
  const originVerifySecret = Buffer.from(env.ORIGIN_VERIFY_SECRET);
  const originVerify: RequestHandler = (req, _res, next) => {
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
      throw new AppError(403, say`You don't have permission to do that.`);
    }
    logger.warn(
      { path: req.path, hasHeader: Boolean(header) },
      "origin_verify_mismatch",
    );
    next();
  };
  app.use(originVerify);
}

// Global rate limit applied to API routes (not /health, /ready). Keyed by
// authenticated user sub when available (per-route auth runs inside routers),
// IP otherwise. Per-route stricter limiters layered inside individual routers.
app.use(globalLimiter);

for (const [path, router] of ROUTER_MOUNTS) app.use(path, router);

app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, "api_started");
});

// Periodic sweep that force-fails topo jobs stuck in pending/processing past a
// timeout. No-op when TOPO_REAPER_INTERVAL_MS=0.
const stopTopoJobReaper = startTopoJobReaper();

// In the background: search answers 503 until the registry has loaded.
const stopPlaceRegistry = startPlaceRegistry();

const shutdown = (signal: string) => lifecycle.begin(server, signal);

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
