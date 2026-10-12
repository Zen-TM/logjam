import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { quote, say } from "@logjam/shared";
import { AppError, errorHandler, fault, malformed } from "./errorHandler";

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
    const err = new AppError(429, say`too many`, { used: 5, quota: 4 });
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
    errorHandler(
      new AppError(404, say`Place not found`),
      req,
      res,
      vi.fn() as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: "Place not found",
      requestId: "req-1",
    });
  });

  it("echoes only whitelisted detail keys (used/quota/resetAt)", () => {
    const { req, res, json } = mockReqRes();
    const details = {
      used: 10,
      quota: 8,
      resetAt: "2026-06-07T00:00:00.000Z",
      // A future caller accidentally attaching sensitive data must NOT leak.
      placeName: "Secret Place",
      latitude: -33.5,
    } as unknown as AppError["details"];
    errorHandler(
      new AppError(507, say`quota`, details),
      req,
      res,
      vi.fn() as NextFunction,
    );
    const body = json.mock.calls[0][0];
    expect(body).toEqual({
      error: "quota",
      requestId: "req-1",
      used: 10,
      quota: 8,
      resetAt: "2026-06-07T00:00:00.000Z",
    });
    expect(body).not.toHaveProperty("placeName");
    expect(body).not.toHaveProperty("latitude");
  });

  it("omits detail keys that are undefined", () => {
    const { req, res, json } = mockReqRes();
    errorHandler(
      new AppError(507, say`quota`, { used: 3 }),
      req,
      res,
      vi.fn() as NextFunction,
    );
    const body = json.mock.calls[0][0];
    expect(body).toHaveProperty("used", 3);
    expect(body).not.toHaveProperty("quota");
    expect(body).not.toHaveProperty("resetAt");
  });

  it("maps an unknown error to a generic 500 with no leakage", () => {
    const { req, res, status, json } = mockReqRes();
    errorHandler(
      new Error("DB exploded at -33.5,150.3"),
      req,
      res,
      vi.fn() as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: "Something went wrong on our end. Please try again.",
      requestId: "req-1",
    });
  });
});

// The API's copy rule (shared/DESIGN.md §11): the user reads a sentence, the
// developer's detail goes where a user never sees it.
describe("a malformed request", () => {
  it("sends one generic sentence, with the detail beside it and in the log", () => {
    const { req, res, status, json, log } = mockReqRes();
    errorHandler(
      malformed("ops[3].opId is required"),
      req,
      res,
      vi.fn() as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error:
        "That didn't work because of a fault in Logjam, not something you did.",
      detail: "ops[3].opId is required",
      requestId: "req-1",
    });
    expect(log.warn.mock.calls[0][0]).toMatchObject({
      detail: "ops[3].opId is required",
    });
  });

  it("scrubs a coordinate out of the detail", () => {
    const { req, res, json, log } = mockReqRes();
    errorHandler(
      malformed("bad point -33.56210, 150.40170"),
      req,
      res,
      vi.fn() as NextFunction,
    );
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("150.4017");
    expect(JSON.stringify(log.warn.mock.calls[0][0])).not.toContain("150.4017");
  });
});

describe("a fault of ours", () => {
  it("logs the detail and sends none of it", () => {
    const { req, res, status, json, log } = mockReqRes();
    errorHandler(
      fault("The place's type is missing"),
      req,
      res,
      vi.fn() as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: "Something went wrong on our end. Please try again.",
      requestId: "req-1",
    });
    expect(log.warn.mock.calls[0][0].detail).toBe(
      "The place's type is missing",
    );
  });
});

// Privacy: a sentence may quote the user's own words back to them; a log line
// never carries a label or a name. Mutation: log `safe.message` as it is.
describe("a sentence that quotes the user", () => {
  it("reaches the user whole and the log without the quoted words", () => {
    const { req, res, json, log } = mockReqRes();
    errorHandler(
      new AppError(
        409,
        say`You already have a place type called ${quote("Ranon exits")}.`,
      ),
      req,
      res,
      vi.fn() as NextFunction,
    );
    expect(json.mock.calls[0][0].error).toBe(
      "You already have a place type called “Ranon exits”.",
    );
    expect(JSON.stringify(log.warn.mock.calls[0][0])).not.toContain("Ranon");
  });

  it("cannot be broken out of with a closing quote", () => {
    const { req, res, log } = mockReqRes();
    errorHandler(
      new AppError(409, say`${quote("Ranon” exits")} is taken.`),
      req,
      res,
      vi.fn() as NextFunction,
    );
    expect(JSON.stringify(log.warn.mock.calls[0][0])).not.toContain("exits");
  });
});
