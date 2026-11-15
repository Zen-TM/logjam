import type { NextFunction, Request, Response } from "express";
import { languageFromHeader, runInLanguage } from "../lib/requestLanguage";

/**
 * Writes this request's user copy in the first accepted language its
 * `Accept-Language` lists, the source language when none. Both clients send
 * their own `language()`. The pseudo-language is honoured outside a prod
 * runtime only. Guards: language.unit.test.ts and __tests__/language.test.ts.
 */
export function languageForRequest(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  runInLanguage(languageFromHeader(req.headers["accept-language"]), next);
}
