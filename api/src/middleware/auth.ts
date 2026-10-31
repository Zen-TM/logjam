import { Request, Response, NextFunction } from "express";
import jwksClient from "jwks-rsa";
import jwt from "jsonwebtoken";
import { say } from "@logjam/shared";
import { AppError } from "../lib/appError";
import { getEnv } from "../lib/env";

// Fail fast at module load if AUTH_MODE=fake would bypass real auth in a non-dev runtime.
// These two guards read process.env, not getEnv(), on purpose: they are a
// second lock beside validateEnv's own fake-in-production check, independent
// of it, so a bug in either still fails closed.
// Three independent signals — any one is sufficient to refuse:
//   1. NODE_ENV is not "development" or "test"
//   2. AWS runtime env vars present (ECS/EB inject these)
//   3. DB_HOST points to a non-local host
if (process.env.AUTH_MODE === "fake") {
  const env = process.env.NODE_ENV;
  const looksProd = env !== "development" && env !== "test";
  const hasAwsRuntime =
    Boolean(process.env.AWS_EXECUTION_ENV) ||
    Boolean(process.env.ECS_CONTAINER_METADATA_URI_V4) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  const dbHost = process.env.DB_HOST ?? "";
  const dbHostNonLocal =
    dbHost !== "" &&
    !/^(localhost|127\.0\.0\.1|host\.docker\.internal|postgres)$/.test(dbHost);
  if (looksProd || hasAwsRuntime || dbHostNonLocal) {
    throw new Error(
      `AUTH_MODE=fake refused: detected non-dev runtime ` +
        `(NODE_ENV=${env}, awsRuntime=${hasAwsRuntime}, dbHostNonLocal=${dbHostNonLocal})`,
    );
  }
}

// Positive fail-closed assertion: any AWS container runtime (ECS/EB Fargate)
// MUST run real auth ("oidc", or its alias "cognito"). This catches a
// misconfigured prod task even if the AUTH_MODE=fake heuristics above were
// somehow all defeated. Guard: src/middleware/auth.unit.test.ts.
if (
  process.env.ECS_CONTAINER_METADATA_URI_V4 &&
  process.env.AUTH_MODE !== "oidc" &&
  process.env.AUTH_MODE !== "cognito"
) {
  throw new Error(
    `AUTH_MODE must be "oidc" (or "cognito") in an AWS container runtime (got "${process.env.AUTH_MODE}").`,
  );
}

let client: jwksClient.JwksClient | null = null;

// The jwks client is cached only once discovery has succeeded, so an issuer
// outage rejects every request meanwhile and recovers without a restart.
async function getClient(): Promise<jwksClient.JwksClient> {
  if (client) return client;
  const issuer = getEnv().OIDC_ISSUER!;
  const res = await fetch(
    `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) throw new Error(`OIDC discovery answered ${res.status}`);
  const doc = (await res.json()) as { issuer?: unknown; jwks_uri?: unknown };
  // A document naming another issuer would let that issuer's keys vouch for ours.
  if (doc.issuer !== issuer) throw new Error("OIDC discovery issuer mismatch");
  if (typeof doc.jwks_uri !== "string") {
    throw new Error("OIDC discovery has no jwks_uri");
  }
  client = jwksClient({ jwksUri: doc.jwks_uri });
  return client;
}

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  getClient().then(
    (c) =>
      c.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        callback(null, key?.getPublicKey());
      }),
    (err) => callback(err),
  );
}

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string; // the provider's subject id
    email: string;
    emailVerified: boolean;
    username: string;
  };
}

// Dev-only fake actors, keyed by sub. Lets integration tests switch the
// acting user per request via the `x-fake-sub` header so sharee and stranger
// perspectives are testable without restarting the API. Subs/usernames mirror
// api/prisma/seed.ts. This is safe: the whole fake branch is unreachable outside
// AUTH_MODE=fake, which the module-load guard above refuses in any non-dev
// runtime; the header is never read in real-auth mode.
const FAKE_ACTORS: Record<string, { email: string; username: string }> = {
  "fake-alice-sub": { email: "alice@local", username: "alice" },
  "fake-bob-sub": { email: "bob@local", username: "bob" },
  "fake-carol-sub": { email: "carol@local", username: "carol" },
};

/** Every way a token fails reads the same to the user; the log says which. */
function signInAgain(detail: string): AppError {
  return new AppError(
    401,
    say`Your sign-in has expired. Sign in again.`,
    undefined,
    detail,
  );
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const env = getEnv();
  if (env.AUTH_MODE === "fake") {
    // Module-load guard above already refuses this in non-dev runtimes.
    // This per-request branch is defence-in-depth only.
    const headerSub = req.headers["x-fake-sub"];
    const sub =
      (typeof headerSub === "string" && headerSub) ||
      env.FAKE_USER_SUB ||
      "fake-alice-sub";
    // Known seed subs get a coherent identity; an unknown sub falls back to
    // alice defaults so behaviour is unchanged when no override is present.
    const actor = FAKE_ACTORS[sub] ?? {
      email: "alice@local",
      username: "alice",
    };
    req.user = {
      sub,
      email: actor.email,
      emailVerified: true,
      username: actor.username,
    };
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    next(signInAgain("Missing or invalid authorization header"));
    return;
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(
    token,
    getKey,
    {
      // Verbatim, trailing slash included: some providers' issuers have one.
      issuer: env.OIDC_ISSUER,
      // ID tokens carry aud=<client id>. Asserting it rejects tokens minted for
      // another client, and Cognito access tokens, which carry no aud.
      audience: env.OIDC_AUDIENCE_LIST as [string, ...string[]],
      algorithms: ["RS256"],
    },
    (err, decoded) => {
      if (err) {
        next(signInAgain("Invalid or expired token"));
        return;
      }

      const payload = decoded as jwt.JwtPayload;

      // token_use is Cognito's: when present it must say "id" (access tokens
      // lack the identity claims); a provider without it is judged on aud alone.
      if (payload.token_use !== undefined && payload.token_use !== "id") {
        next(signInAgain("Invalid token type"));
        return;
      }

      // Assert the identity claims this app relies on are present and typed.
      // A partially-populated req.user (undefined email) would otherwise reach
      // prisma.user.create and either crash or create an inconsistent row.
      if (
        typeof payload.sub !== "string" ||
        typeof payload.email !== "string"
      ) {
        next(signInAgain("Token is missing required identity claims"));
        return;
      }

      // Optional: not every provider sends one, and only a first login reads it
      // (initialUsernameFor in routes/users.ts names the account without it).
      const username =
        payload.preferred_username || payload["cognito:username"];
      req.user = {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        username: typeof username === "string" ? username : "",
      };

      next();
    },
  );
}
