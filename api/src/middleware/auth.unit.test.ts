import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
  beforeAll,
} from "vitest";
import { createServer, type Server } from "node:http";
import { createHmac, generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// getEnv() parses once and caches; these tests switch config between cases,
// so they read the live process.env instead.
vi.mock("../lib/env", () => ({
  getEnv: () => ({
    ...process.env,
    OIDC_AUDIENCE_LIST: (process.env.OIDC_AUDIENCE ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  }),
}));

import type { AuthenticatedRequest } from "./auth";

type RequireAuth = typeof import("./auth").requireAuth;
let requireAuth: RequireAuth;

const ORIGINAL_ENV = { ...process.env };

// Real crypto end to end: an in-process issuer serves discovery and JWKS, and
// tokens are really signed, so a verification that stops checking something
// (signature, alg, iss, aud) turns a test red instead of passing on a mock.
const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = signing.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const jwks = {
  keys: [
    {
      ...signing.publicKey.export({ format: "jwk" }),
      kid: "k1",
      alg: "RS256",
      use: "sig",
    },
  ],
};

const PATH = "/pool";
let server: Server;
let base: string;
let issuer: string;
// What the fake issuer does, reset per test.
let discoveryIssuer: string | undefined;
let down: boolean;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (down) return req.socket.destroy();
    if (req.url?.endsWith("/.well-known/openid-configuration")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          issuer: discoveryIssuer ?? issuer,
          jwks_uri: `${base}/keys.json`,
        }),
      );
    } else if (req.url === "/keys.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(jwks));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  down = false;
  discoveryIssuer = undefined;
  issuer = base + PATH;
  process.env.AUTH_MODE = "oidc";
  process.env.OIDC_ISSUER = issuer;
  process.env.OIDC_AUDIENCE = "web-client,gps-client";
  // auth.ts caches its jwks client at module level.
  vi.resetModules();
  ({ requireAuth } = await import("./auth"));
});

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, ORIGINAL_ENV);
});

const CLAIMS = {
  sub: "sub-1",
  email: "alice@example.com",
  email_verified: true,
  preferred_username: "alice",
};

function sign(
  claims: Record<string, unknown> = CLAIMS,
  opts: {
    key?: typeof signing.privateKey;
    iss?: string;
    aud?: string | null;
  } = {},
) {
  return jwt.sign(claims, opts.key ?? signing.privateKey, {
    algorithm: "RS256",
    keyid: "k1",
    expiresIn: "5m",
    issuer: opts.iss ?? issuer,
    ...(opts.aud === null ? {} : { audience: opts.aud ?? "web-client" }),
  });
}

/** Runs requireAuth to completion; resolves to what it passed to next(). */
function run(
  token?: string,
): Promise<{ req: AuthenticatedRequest; err: unknown }> {
  const req = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as AuthenticatedRequest;
  return new Promise((resolve) => {
    requireAuth(
      req,
      {} as Response,
      ((err?: unknown) => resolve({ req, err })) as NextFunction,
    );
  });
}

const SIGN_IN_AGAIN = {
  statusCode: 401,
  message: "Your sign-in has expired. Sign in again.",
};

describe("requireAuth — fake mode", () => {
  it("populates a seeded user and calls next", async () => {
    process.env.AUTH_MODE = "fake";
    const { req, err } = await run();
    expect(err).toBeUndefined();
    expect(req.user?.username).toBe("alice");
    expect(req.user?.sub).toBeDefined();
  });
});

// Mutation for each test: remove the check it names from requireAuth / getClient
// (the jwt.verify option, the token_use test, the discovery comparison) and the
// matching test goes red.
describe("requireAuth — oidc mode, real tokens", () => {
  it("401s when the authorization header is missing", async () => {
    expect((await run()).err).toMatchObject({
      ...SIGN_IN_AGAIN,
      devDetail: "Missing or invalid authorization header",
    });
  });

  it("accepts a valid token and populates req.user", async () => {
    const { req, err } = await run(sign());
    expect(err).toBeUndefined();
    expect(req.user).toEqual({
      sub: "sub-1",
      email: "alice@example.com",
      emailVerified: true,
      username: "alice",
    });
  });

  it("accepts a token for the second audience in the list", async () => {
    expect(
      (await run(sign(CLAIMS, { aud: "gps-client" }))).err,
    ).toBeUndefined();
  });

  it("rejects a token for an audience not in the list", async () => {
    expect(
      (await run(sign(CLAIMS, { aud: "someone-else" }))).err,
    ).toMatchObject(SIGN_IN_AGAIN);
  });

  it("rejects a token with no aud (what a Cognito access token looks like)", async () => {
    expect((await run(sign(CLAIMS, { aud: null }))).err).toMatchObject(
      SIGN_IN_AGAIN,
    );
  });

  it("rejects a genuine signature under another issuer", async () => {
    expect(
      (await run(sign(CLAIMS, { iss: "https://evil.example.com" }))).err,
    ).toMatchObject(SIGN_IN_AGAIN);
  });

  it("rejects a token signed by a different key", async () => {
    expect(
      (await run(sign(CLAIMS, { key: stranger.privateKey }))).err,
    ).toMatchObject(SIGN_IN_AGAIN);
  });

  it("rejects alg none", async () => {
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const token = `${b64({ alg: "none", typ: "JWT", kid: "k1" })}.${b64({
      ...CLAIMS,
      iss: issuer,
      aud: "web-client",
    })}.`;
    expect((await run(token)).err).toMatchObject(SIGN_IN_AGAIN);
  });

  it("rejects HS256 signed with the public key as the secret", async () => {
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const body = `${b64({ alg: "HS256", typ: "JWT", kid: "k1" })}.${b64({
      ...CLAIMS,
      iss: issuer,
      aud: "web-client",
    })}`;
    const mac = createHmac("sha256", publicPem)
      .update(body)
      .digest("base64url");
    expect((await run(`${body}.${mac}`)).err).toMatchObject(SIGN_IN_AGAIN);
  });

  it("rejects token_use=access", async () => {
    expect(
      (await run(sign({ ...CLAIMS, token_use: "access" }))).err,
    ).toMatchObject({ ...SIGN_IN_AGAIN, devDetail: "Invalid token type" });
  });

  it("accepts token_use=id", async () => {
    expect(
      (await run(sign({ ...CLAIMS, token_use: "id" }))).err,
    ).toBeUndefined();
  });

  it("accepts a token with no token_use", async () => {
    expect((await run(sign())).err).toBeUndefined();
  });

  it("rejects a token missing identity claims", async () => {
    expect((await run(sign({ sub: "sub-1" }))).err).toMatchObject({
      ...SIGN_IN_AGAIN,
      devDetail: "Token is missing required identity claims",
    });
  });

  it("falls back to cognito:username", async () => {
    const { req, err } = await run(
      sign({
        ...CLAIMS,
        preferred_username: undefined,
        "cognito:username": "c-alice",
      }),
    );
    expect(err).toBeUndefined();
    expect(req.user?.username).toBe("c-alice");
  });

  it("rejects every request while discovery is down, and recovers without a restart", async () => {
    const token = sign();
    down = true;
    expect((await run(token)).err).toMatchObject(SIGN_IN_AGAIN);
    expect((await run(token)).err).toMatchObject(SIGN_IN_AGAIN);
    down = false;
    expect((await run(token)).err).toBeUndefined();
  });

  it("rejects when the discovery document names another issuer", async () => {
    discoveryIssuer = "https://evil.example.com";
    expect((await run(sign())).err).toMatchObject(SIGN_IN_AGAIN);
  });

  it("works with a trailing-slash issuer, compared verbatim", async () => {
    issuer = `${base}${PATH}/`;
    process.env.OIDC_ISSUER = issuer;
    expect((await run(sign())).err).toBeUndefined();
    // Same key, issuer without the slash: not the configured issuer.
    expect(
      (await run(sign(CLAIMS, { iss: `${base}${PATH}` }))).err,
    ).toMatchObject(SIGN_IN_AGAIN);
  });
});

describe("auth module-load fail-closed guards", () => {
  // Mutation: delete the positive check, or let it accept only "cognito", or
  // drop the fake-refused guard, and the matching test goes red.

  it("refuses AUTH_MODE=fake in a production NODE_ENV", async () => {
    vi.resetModules();
    process.env.AUTH_MODE = "fake";
    process.env.NODE_ENV = "production";
    process.env.DB_HOST = "localhost";
    await expect(import("./auth")).rejects.toThrow(/refused/);
  });

  it("refuses AUTH_MODE=fake against a non-local DB host", async () => {
    vi.resetModules();
    process.env.AUTH_MODE = "fake";
    process.env.NODE_ENV = "test";
    process.env.DB_HOST = "prod.abc.ap-southeast-2.rds.amazonaws.com";
    await expect(import("./auth")).rejects.toThrow(/refused/);
  });

  it("refuses AUTH_MODE=fake in an AWS container runtime", async () => {
    vi.resetModules();
    process.env.AUTH_MODE = "fake";
    process.env.NODE_ENV = "test";
    process.env.DB_HOST = "localhost";
    process.env.ECS_CONTAINER_METADATA_URI_V4 = "http://169.254.170.2/v4";
    await expect(import("./auth")).rejects.toThrow(/refused/);
  });

  it("refuses AUTH_MODE=fake in a prod runtime however NODE_ENV reads", async () => {
    vi.resetModules();
    process.env.AUTH_MODE = "fake";
    process.env.NODE_ENV = "test";
    process.env.DB_HOST = "localhost";
    process.env.AWS_EXECUTION_ENV = "AWS_ECS_FARGATE";
    await expect(import("./auth")).rejects.toThrow(/refused/);
  });

  it.each(["oidc", "cognito"])(
    "accepts AUTH_MODE=%s in an AWS container runtime",
    async (mode) => {
      vi.resetModules();
      process.env.AUTH_MODE = mode;
      process.env.NODE_ENV = "test";
      process.env.ECS_CONTAINER_METADATA_URI_V4 = "http://169.254.170.2/v4";
      await expect(import("./auth")).resolves.toBeDefined();
    },
  );

  it("refuses any other AUTH_MODE in an AWS container runtime", async () => {
    vi.resetModules();
    process.env.AUTH_MODE = "bogus";
    process.env.NODE_ENV = "test";
    process.env.ECS_CONTAINER_METADATA_URI_V4 = "http://169.254.170.2/v4";
    await expect(import("./auth")).rejects.toThrow(/must be "oidc"/);
  });

  it("imports cleanly in a normal dev runtime", async () => {
    vi.resetModules();
    process.env.AUTH_MODE = "fake";
    process.env.NODE_ENV = "development";
    process.env.DB_HOST = "localhost";
    delete process.env.ECS_CONTAINER_METADATA_URI_V4;
    delete process.env.AWS_EXECUTION_ENV;
    await expect(import("./auth")).resolves.toBeDefined();
  });
});
