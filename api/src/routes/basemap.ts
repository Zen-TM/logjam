// Protomaps offline region clips: synchronous
// `pmtiles extract --bbox` against our own archive, streamed back through a
// short-lived opaque token — no S3 write, no presigned URL, no bbox in any
// URL or log line.
//
// PRIVACY BOUNDARY (root AGENTS.md): the request bbox is place-area
// knowledge. It lives in the POST *body* only (redacted via redactPaths in
// lib/logger.ts), is never interpolated into error messages, filenames, or
// the GET URL, and the clipped file is deleted on send or after a 120 s TTL.
import { say } from "@logjam/shared";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs, createReadStream } from "fs";
import os from "os";
import path from "path";
import { NextFunction, Router, Response } from "express";

import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { regionClipLimiter } from "../middleware/rateLimit";
import { resolveUser } from "../lib/resolveUser";
import { getEnv } from "../lib/env";
import { demArchiveFor } from "../services/elevation";
import { logger } from "../lib/logger";
import {
  CLIP_TOKEN_TTL_MS,
  MAX_CLIP_OUTPUT_BYTES,
  createClipTokenStore,
  pmtilesExtractArgs,
  validateRegionClipRequest,
  CLIP_TOO_LARGE,
} from "../lib/regionClip";

const router = Router();
const env = getEnv();

const clipTokens = createClipTokenStore(CLIP_TOKEN_TTL_MS);

// TTL sweep: delete expired clip files regardless of whether the GET arrived.
// unref() so the interval never holds the process open (mirrors reaper style).
const sweepInterval = setInterval(() => {
  for (const stalePath of clipTokens.sweepExpired()) {
    fs.unlink(stalePath).catch(() => {
      // Best-effort: the file may already be gone; nothing sensitive remains
      // in the name (uuid) and /tmp is instance-local.
    });
  }
}, 30_000);
sweepInterval.unref();

const EXTRACT_TIMEOUT_MS = 25_000; // inside CloudFront's 30 s origin read timeout

function runPmtilesExtract(
  archiveUri: string,
  outPath: string,
  bboxArg: string,
  maxzoom: number,
  minzoom?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Args passed as an array — no shell, no injection surface. The bbox
    // reaches only the pmtiles process, never a log line.
    const child = spawn(
      "pmtiles",
      pmtilesExtractArgs(
        archiveUri,
        outPath,
        bboxArg,
        maxzoom,
        env.AWS_REGION,
        minzoom,
      ),
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    // Collect stderr for failure classification but never log it raw — the
    // command line (with bbox) can appear in tool error output.
    let stderrTail = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-500);
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new AppError(
          504,
          say`That area took too long to prepare. Try a smaller one.`,
        ),
      );
    }, EXTRACT_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(
        err.message.includes("ENOENT")
          ? new AppError(503, say`Map downloads aren't available right now.`)
          : err,
      );
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else {
        logger.error(
          { exitCode: code },
          "pmtiles extract failed", // static message; no bbox, no stderr
        );
        reject(new AppError(502, say`Couldn't prepare that area. Try again.`));
      }
    });
  });
}

// POST /basemap/region-clip — validate caps, extract, hand back a token.
router.post(
  "/region-clip",
  requireAuth,
  regionClipLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const validated = validateRegionClipRequest(req.body);
    if (!validated.ok) throw validated.error;
    const { bbox, minzoom, maxzoom, archive } = validated.value;
    // A DEM or contour archive is cut from where it is served (shared
    // demSources.ts, nswContours.ts); the basemap from its own configured
    // location.
    const archiveUri = archive
      ? env.TOPO_CDN_BASE_URL &&
        `${env.TOPO_CDN_BASE_URL.replace(/\/$/, "")}/${archive.archivePath}`
      : env.PROTOMAPS_ARCHIVE_URI;
    // An archive that is not there yet is "not available", which the phone
    // skips quietly for these two; a clip that then fails is a 502 it reports.
    if (!archiveUri || (archive && !(await demArchiveFor(archive)))) {
      throw new AppError(503, say`Map downloads aren't available right now.`);
    }

    const outPath = path.join(os.tmpdir(), `clip-${randomUUID()}.pmtiles`);
    const bboxArg = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
    try {
      await runPmtilesExtract(archiveUri, outPath, bboxArg, maxzoom, minzoom);
      const { size } = await fs.stat(outPath);
      if (size > MAX_CLIP_OUTPUT_BYTES) {
        await fs.unlink(outPath);
        throw new AppError(413, CLIP_TOO_LARGE);
      }
      const { token, expiresAt } = clipTokens.issue({
        path: outPath,
        userId: user.id,
        sizeBytes: size,
      });
      res.json({
        token,
        sizeBytes: size,
        expiresInSeconds: Math.floor((expiresAt - Date.now()) / 1000),
      });
    } catch (err) {
      // Never leave a bbox-shaped artifact behind on failure.
      await fs.unlink(outPath).catch(() => {});
      throw err;
    }
  },
);

// GET /basemap/region-clip/:token — stream the clip once, then delete it.
// GET-shaped because expo-file-system's downloadResumable needs a URL; the
// token is an opaque uuid so nothing coordinate-shaped lands in access logs.
router.get(
  "/region-clip/:token",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = await resolveUser(req.user!.sub);
    const token = req.params.token;
    const entry =
      typeof token === "string" ? clipTokens.take(token, user.id) : null;
    // Missing, expired, or another user's token are indistinguishable (404,
    // anti-oracle convention).
    if (!entry)
      throw new AppError(404, say`That download has expired. Start it again.`);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(entry.sizeBytes));
    const stream = createReadStream(entry.path);
    stream.pipe(res);
    const cleanup = () => {
      fs.unlink(entry.path).catch(() => {});
    };
    stream.on("close", cleanup);
    stream.on("error", (err) => {
      cleanup();
      // A download that dies half-way must not end as if it were complete.
      // Once pipe() has flushed the headers the only way to signal failure is
      // to destroy the response; before that the errorHandler still gets to
      // answer with an AppError.
      if (res.headersSent) res.destroy(err);
      else {
        // The clip headers are already set; the JSON answer is not a clip.
        res.removeHeader("Content-Type");
        res.removeHeader("Content-Length");
        next(new AppError(503, say`That download failed. Start it again.`));
      }
    });
  },
);

export default router;
