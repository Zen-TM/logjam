import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { quote, say } from "@logjam/shared";

import { AppError, errorHandler } from "./errorHandler";
import { languageForRequest } from "./language";

const REFUSAL = "Couldn't find that place.";
const QUOTED = "“Secret Canyon” is the name of a built-in attribute.";

function app(withMiddleware = true) {
  const server = express();
  if (withMiddleware) server.use(languageForRequest);
  server.use(express.json());
  server.get("/plain", () => {
    throw new AppError(404, say`Couldn't find that place.`);
  });
  server.get("/quoted", () => {
    throw new AppError(
      409,
      say`${quote("Secret Canyon")} is the name of a built-in attribute.`,
    );
  });
  server.get("/slow", async (req, _res, next) => {
    await new Promise((resolve) =>
      setTimeout(resolve, req.query.ms ? Number(req.query.ms) : 0),
    );
    next(new AppError(404, say`Couldn't find that place.`));
  });
  server.post("/body", (_req, res) => {
    res.json({});
  });
  server.use(errorHandler);
  return server;
}

const errorOf = async (path: string, language?: string) => {
  const call = request(app()).get(path);
  const res = await (language === undefined
    ? call
    : call.set("Accept-Language", language));
  return res.body.error as string;
};

describe("a refusal's language", () => {
  // Mutation: in languageForRequest, call `next()` without `runInLanguage`,
  // and the pseudo-language never reaches a refusal.
  it("is the pseudo-language when the request names it, with the user's quoted words as typed", async () => {
    const wrapped = await errorOf("/quoted", "en-XA");
    expect(wrapped).not.toBe(QUOTED);
    expect(wrapped.startsWith("⟦")).toBe(true);
    expect(wrapped).toContain("“Secret Canyon”");
  });

  // Mutation: in languageFromHeader, match `[...wanted, "en-XA"]`, and a
  // request that names nothing Logjam has is answered in the pseudo-language.
  it("is English with no header, with one naming a language Logjam has not got, or with en-AU", async () => {
    expect(await errorOf("/plain")).toBe(REFUSAL);
    expect(await errorOf("/plain", "fr")).toBe(REFUSAL);
    expect(await errorOf("/plain", "en-AU")).toBe(REFUSAL);
    expect(await errorOf("/quoted", "fr")).toBe(QUOTED);
  });

  // Mutation: have languageForRequest accept every `Language`, and a prod
  // runtime answers a request in the pseudo-language.
  it("is English in a prod runtime that is asked for the pseudo-language", async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(await errorOf("/plain", "en-XA")).toBe(REFUSAL);
    } finally {
      process.env.NODE_ENV = before;
    }
  });

  // Mutation: keep the language in a module variable instead of
  // AsyncLocalStorage, and the slow request is written in the fast one's.
  it("does not leak between two requests in flight at once", async () => {
    const [slow, fast] = await Promise.all([
      errorOf("/slow?ms=30", "en-XA"),
      errorOf("/slow?ms=1", "en-AU"),
    ]);
    expect(fast).toBe(REFUSAL);
    expect(slow.startsWith("⟦")).toBe(true);
  });

  // Mutation: delete the `runInLanguage` in errorHandler, and a refusal made
  // outside the middleware's context (a body Express cannot parse, read in a
  // stream callback) is written in English whatever the request asked for.
  it("holds for a refusal the error handler writes itself", async () => {
    const res = await request(app(false))
      .post("/body")
      .set("Accept-Language", "en-XA")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.startsWith("⟦")).toBe(true);
  });
});
