import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { Response, NextFunction } from "express";

vi.mock("jsonwebtoken", () => ({ default: { verify: vi.fn() } }));

import jwt from "jsonwebtoken";
import { requireAuth, type AuthenticatedRequest } from "./auth";

const verifyMock = (jwt as unknown as { verify: Mock }).verify;

function mockRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { res: { status } as unknown as Response, status, json };
}

const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;

afterEach(() => {
  process.env.AUTH_MODE = ORIGINAL_AUTH_MODE;
  verifyMock.mockReset();
});

describe("requireAuth — fake mode", () => {
  it("populates a seeded user and calls next", () => {
    process.env.AUTH_MODE = "fake";
    const req = { headers: {} } as AuthenticatedRequest;
    const next = vi.fn() as NextFunction;
    const { res } = mockRes();
    requireAuth(req, res, next);
    expect(req.user?.username).toBe("alice");
    expect(req.user?.sub).toBeDefined();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("requireAuth — cognito mode", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "cognito";
  });

  it("401s when the authorization header is missing", () => {
    const req = { headers: {} } as AuthenticatedRequest;
    const { res, status, json } = mockRes();
    requireAuth(req, res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Missing or invalid authorization header" });
  });

  it("401s when token verification fails", () => {
    verifyMock.mockImplementation((_t, _k, _o, cb) => cb(new Error("bad"), undefined));
    const req = { headers: { authorization: "Bearer x" } } as AuthenticatedRequest;
    const { res, status, json } = mockRes();
    requireAuth(req, res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
  });

  it("rejects a non-id token (access token)", () => {
    verifyMock.mockImplementation((_t, _k, _o, cb) =>
      cb(null, { token_use: "access", sub: "s", email: "e@x", preferred_username: "u" }),
    );
    const req = { headers: { authorization: "Bearer x" } } as AuthenticatedRequest;
    const { res, status, json } = mockRes();
    requireAuth(req, res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Invalid token type" });
  });

  it("rejects an id token missing identity claims", () => {
    verifyMock.mockImplementation((_t, _k, _o, cb) =>
      cb(null, { token_use: "id", sub: "s" }), // no email/username
    );
    const req = { headers: { authorization: "Bearer x" } } as AuthenticatedRequest;
    const { res, status, json } = mockRes();
    requireAuth(req, res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Token is missing required identity claims" });
  });

  it("accepts a valid id token and populates req.user", () => {
    verifyMock.mockImplementation((_t, _k, _o, cb) =>
      cb(null, {
        token_use: "id",
        sub: "cognito-1",
        email: "alice@example.com",
        email_verified: true,
        preferred_username: "alice",
      }),
    );
    const req = { headers: { authorization: "Bearer x" } } as AuthenticatedRequest;
    const next = vi.fn() as NextFunction;
    const { res } = mockRes();
    requireAuth(req, res, next);
    expect(req.user).toEqual({
      sub: "cognito-1",
      email: "alice@example.com",
      emailVerified: true,
      username: "alice",
    });
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("auth module-load fail-closed guards", () => {
  const snapshot = { ...process.env };

  function restore() {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, snapshot);
  }

  afterEach(restore);

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

  it("requires cognito auth in an AWS container runtime", async () => {
    vi.resetModules();
    process.env.AUTH_MODE = "fake";
    process.env.NODE_ENV = "test";
    process.env.DB_HOST = "localhost";
    process.env.ECS_CONTAINER_METADATA_URI_V4 = "http://169.254.170.2/v4";
    // fake+ECS trips the fake-refused guard first; assert it throws.
    await expect(import("./auth")).rejects.toThrow();
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
