import { Request, Response, NextFunction } from "express";
import jwksClient from "jwks-rsa";
import jwt from "jsonwebtoken";

// Fail fast at module load if AUTH_MODE=fake would bypass Cognito in a non-dev runtime.
// Three independent signals — any one is sufficient to refuse:
//   1. NODE_ENV is not "development" or "test"
//   2. AWS runtime env vars present (ECS/EB inject these)
//   3. DATABASE_URL points to a non-local host
if (process.env.AUTH_MODE === "fake") {
  const env = process.env.NODE_ENV;
  const looksProd = env !== "development" && env !== "test";
  const hasAwsRuntime =
    Boolean(process.env.AWS_EXECUTION_ENV) ||
    Boolean(process.env.ECS_CONTAINER_METADATA_URI_V4) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  const dbUrl = process.env.DATABASE_URL ?? "";
  const dbHostNonLocal =
    dbUrl !== "" &&
    !/@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres)(:|\/|$)/.test(dbUrl);
  if (looksProd || hasAwsRuntime || dbHostNonLocal) {
    throw new Error(
      `AUTH_MODE=fake refused: detected non-dev runtime ` +
        `(NODE_ENV=${env}, awsRuntime=${hasAwsRuntime}, dbHostNonLocal=${dbHostNonLocal})`,
    );
  }
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

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (process.env.AUTH_MODE === "fake") {
    // Module-load guard above already refuses this in non-dev runtimes.
    // This per-request branch is defence-in-depth only.
    req.user = {
      sub: process.env.FAKE_USER_SUB ?? "fake-alice-sub",
      email: "alice@local",
      emailVerified: true,
      username: "alice",
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
      algorithms: ["RS256"],
    },
    (err, decoded) => {
      if (err) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }

      const payload = decoded as jwt.JwtPayload;
      req.user = {
        sub: payload.sub!,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        username: payload.preferred_username || payload["cognito:username"],
      };

      next();
    },
  );
}
