import pino from "pino";
import { getEnv } from "./env";

const env = getEnv();

// Redact paths that could leak canyon coordinates or names into logs.
// Pino redaction is shallow on nested objects unless the path is exact;
// enumerate every known leak vector for canyon/trip-log payloads.
const redactPaths = [
  // Express request body shapes for canyon/trip endpoints
  'req.body.latitude',
  'req.body.longitude',
  'req.body.name',
  'req.body.altNames',
  'req.body.notes',
  'req.body.coords',
  'req.body.coordinates',
  'req.body.canyon.latitude',
  'req.body.canyon.longitude',
  'req.body.canyon.name',
  'req.body.canyon.notes',
  // Generic wildcards for nested payloads
  '*.latitude',
  '*.longitude',
  '*.coords',
  '*.coordinates',
  // Authorization headers (never log credentials)
  'req.headers.authorization',
  'req.headers["x-fake-auth"]',
  'req.headers.cookie',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: redactPaths,
    censor: '[redacted]',
  },
  base: { env: env.NODE_ENV },
});
