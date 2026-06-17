import { Request, Response, NextFunction } from "express";
import jwksClient from "jwks-rsa";
import jwt from "jsonwebtoken";

// Fail fast at module load if AUTH_MODE=fake would bypass Cognito in a non-dev runtime.
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
// MUST run cognito auth. This catches a misconfigured prod task even if the
// AUTH_MODE=fake heuristics above were somehow all defeated.
if (
  process.env.ECS_CONTAINER_METADATA_URI_V4 &&
  process.env.AUTH_MODE !== "cognito"
) {
  throw new Error(
    `AUTH_MODE must be "cognito" in an AWS container runtime (got "${process.env.AUTH_MODE}").`,
  );
}

let client: jwksClient.JwksClient | null = null;

function getClient() {
  if (!client) {
    client = jwksClient({
      jwksUri: `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
    });
  }
  return client;
}

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  getClient().getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string; // Cognito user ID
    email: string;
    emailVerified: boolean;
    username: string;
  };
}

// Dev-only fake actors, keyed by Cognito sub. Lets integration tests switch the
// acting user per request via the `x-fake-sub` header WITHOUT restarting the API
// (the old single-user limitation that made sharee/stranger perspectives
// untestable — see SEC-001). Subs/usernames mirror api/prisma/seed.ts. This is
// safe: the whole fake branch is unreachable outside AUTH_MODE=fake, which the
// module-load guard above refuses in any non-dev runtime; the header is never
// read in cognito mode.
const FAKE_ACTORS: Record<string, { email: string; username: string }> = {
  "fake-alice-sub": { email: "alice@local", username: "alice" },
  "fake-bob-sub": { email: "bob@local", username: "bob" },
  "fake-carol-sub": { email: "carol@local", username: "carol" },
};

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (process.env.AUTH_MODE === "fake") {
    // Module-load guard above already refuses this in non-dev runtimes.
    // This per-request branch is defence-in-depth only.
    const headerSub = req.headers["x-fake-sub"];
    const sub =
      (typeof headerSub === "string" && headerSub) ||
      process.env.FAKE_USER_SUB ||
      "fake-alice-sub";
    // Known seed subs get a coherent identity; an unknown sub keeps the historical
    // alice defaults so behaviour is unchanged when no override is present.
    const actor = FAKE_ACTORS[sub] ?? { email: "alice@local", username: "alice" };
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
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(
    token,
    getKey,
    {
      issuer: `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`,
      // Cognito ID tokens carry aud=<app client id>. Asserting audience rejects
      // tokens minted for a different app client in the same user pool.
      audience: process.env.COGNITO_CLIENT_ID,
      algorithms: ["RS256"],
    },
    (err, decoded) => {
      if (err) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }

      const payload = decoded as jwt.JwtPayload;

      // Reject Cognito access tokens (token_use=access). They are signed by the
      // same JWKS under the same issuer but lack identity claims (email,
      // preferred_username). Only ID tokens establish identity here.
      if (payload.token_use !== "id") {
        res.status(401).json({ error: "Invalid token type" });
        return;
      }

      // Assert the identity claims this app relies on are present and typed.
      // A partially-populated req.user (undefined email) would otherwise reach
      // prisma.user.create and either crash or create an inconsistent row.
      const username =
        payload.preferred_username || payload["cognito:username"];
      if (
        typeof payload.sub !== "string" ||
        typeof payload.email !== "string" ||
        typeof username !== "string" ||
        username.length === 0
      ) {
        res.status(401).json({ error: "Token is missing required identity claims" });
        return;
      }

      req.user = {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        username,
      };

      next();
    },
  );
}
