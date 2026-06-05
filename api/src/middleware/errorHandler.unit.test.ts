import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { AppError, errorHandler } from "./errorHandler";

function mockReqRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const log = { warn: vi.fn(), error: vi.fn() };
  const req = { id: "req-1", log } as unknown as Request;
  const res = { status } as unknown as Response;
  return { req, res, status, json, log };
}

describe("AppError", () => {
  it("stores statusCode, message, and details", () => {
    const err = new AppError(429, "too many", { used: 5, quota: 4 });
    expect(err.statusCode).toBe(429);
    expect(err.message).toBe("too many");
    expect(err.details).toEqual({ used: 5, quota: 4 });
    expect(err.name).toBe("AppError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("errorHandler", () => {
  it("responds with the AppError status and message", () => {
    const { req, res, status, json } = mockReqRes();
    errorHandler(new AppError(404, "Canyon not found"), req, res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "Canyon not found", requestId: "req-1" });
  });

  it("echoes only whitelisted detail keys (used/quota/resetAt)", () => {
    const { req, res, json } = mockReqRes();
    const details = {
      used: 10,
      quota: 8,
      resetAt: "2026-06-07T00:00:00.000Z",
      // A future caller accidentally attaching sensitive data must NOT leak.
      canyonName: "Secret Canyon",
      latitude: -33.5,
    } as unknown as AppError["details"];
    errorHandler(new AppError(507, "quota", details), req, res, vi.fn() as NextFunction);
    const body = json.mock.calls[0][0];
    expect(body).toEqual({
      error: "quota",
      requestId: "req-1",
      used: 10,
      quota: 8,
      resetAt: "2026-06-07T00:00:00.000Z",
    });
    expect(body).not.toHaveProperty("canyonName");
    expect(body).not.toHaveProperty("latitude");
  });

  it("omits detail keys that are undefined", () => {
    const { req, res, json } = mockReqRes();
    errorHandler(new AppError(507, "quota", { used: 3 }), req, res, vi.fn() as NextFunction);
    const body = json.mock.calls[0][0];
    expect(body).toHaveProperty("used", 3);
    expect(body).not.toHaveProperty("quota");
    expect(body).not.toHaveProperty("resetAt");
  });

  it("maps an unknown error to a generic 500 with no leakage", () => {
    const { req, res, status, json } = mockReqRes();
    errorHandler(new Error("DB exploded at -33.5,150.3"), req, res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: "Internal server error", requestId: "req-1" });
  });
});
