import { describe, expect, it } from "vitest";
import { say, t } from "@logjam/shared";
import {
  languageFromHeader,
  languageOfAccount,
  offeredLanguages,
  runInLanguage,
} from "./requestLanguage";

const DEV = { NODE_ENV: "development", DB_HOST: "localhost" };
const PROD = { NODE_ENV: "production", DB_HOST: "localhost" };

describe("the language of a request", () => {
  // Mutation: delete the `setLanguageResolver` call in requestLanguage.ts, and
  // every sentence is English whatever the request asked for.
  it("is what say and t write in, inside runInLanguage", () => {
    const written = runInLanguage("en-XA", () => t`Try again.`);
    expect(written).not.toBe("Try again.");
    expect(written.startsWith("⟦")).toBe(true);
    expect(t`Try again.`).toBe("Try again.");
  });

  // Mutation: replace AsyncLocalStorage with a module variable, and the slower
  // request's sentence is written in the language of the one that ran last.
  it("does not leak between two requests in flight at once", async () => {
    const written = (lang: "en-XA" | "en-AU", ms: number) =>
      runInLanguage(lang, async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        return say`Couldn't find that place.`;
      });
    const [slow, fast] = await Promise.all([
      written("en-XA", 20),
      written("en-AU", 1),
    ]);
    expect(fast).toBe("Couldn't find that place.");
    expect(slow).not.toBe("Couldn't find that place.");
    expect(slow.startsWith("⟦")).toBe(true);
  });
});

describe("offeredLanguages", () => {
  // Mutation: return LANGUAGES in a prod runtime, and a client can ask the
  // production API for the pseudo-language.
  it("leaves out the pseudo-language in a prod runtime only", () => {
    expect(offeredLanguages(DEV)).toContain("en-XA");
    expect(offeredLanguages(PROD)).not.toContain("en-XA");
    expect(offeredLanguages(PROD)).toContain("en-US");
    expect(
      offeredLanguages({ LOGJAM_RUNTIME: "prod", NODE_ENV: "development" }),
    ).not.toContain("en-XA");
  });

  // Mutation: build the default from `getEnv()` instead of `process.env`
  // (`import { getEnv } from "./env"`, `env: NodeJS.ProcessEnv = getEnv()`), which
  // drops the AWS variables, and a process that only an AWS variable gives away
  // as not dev offers the pseudo-language.
  it("reads the running process's environment, as the other dev-only refusals do", () => {
    expect(offeredLanguages()).toContain("en-XA");
    for (const [name, value] of [
      ["NODE_ENV", "production"],
      ["AWS_EXECUTION_ENV", "x"],
      ["ECS_CONTAINER_METADATA_URI_V4", "x"],
      ["AWS_LAMBDA_FUNCTION_NAME", "x"],
    ] as const) {
      const before = process.env[name];
      process.env[name] = value;
      try {
        expect(offeredLanguages()).not.toContain("en-XA");
      } finally {
        if (before === undefined) delete process.env[name];
        else process.env[name] = before;
      }
    }
  });
});

describe("languageFromHeader", () => {
  // Mutation: return the source language whatever the header says.
  it.each([
    ["en-US", "en-US"],
    ["en_US", "en-US"],
    ["en-XA", "en-XA"],
    ["fr, en-US;q=0.5", "en-US"],
    ["en-US;q=0.5, en-XA;q=0.9", "en-XA"],
    ["en-US;q=0, en-XA", "en-XA"],
    ["en-US;q=0", "en-AU"],
    ["en-XA;Q=0, en-US", "en-US"],
    ["en-NZ, fr", "en-AU"],
    ["fr", "en-AU"],
    ["", "en-AU"],
    ["*", "en-AU"],
  ])("reads %j as %s", (header, wanted) => {
    expect(languageFromHeader(header, DEV)).toBe(wanted);
  });

  // Mutation: read `header` without `?? ""`, and a request with no header throws.
  it("reads no header as the source language", () => {
    expect(languageFromHeader(undefined, DEV)).toBe("en-AU");
  });

  // Mutation: match against LANGUAGES instead of offeredLanguages(env), and
  // the pseudo-language is honoured in a prod runtime.
  it("does not honour the pseudo-language in a prod runtime", () => {
    expect(languageFromHeader("en-XA", PROD)).toBe("en-AU");
    expect(languageFromHeader("en-XA, en-US", PROD)).toBe("en-US");
  });
});

describe("languageOfAccount", () => {
  // Mutation: read the language without the prod check, and a stored en-XA
  // turns a prod push or mail into the pseudo-language.
  it("is the one the account's client last ran in, else the source", () => {
    expect(languageOfAccount({ language: "en-US" }, PROD)).toBe("en-US");
    expect(languageOfAccount({ language: "en-XA" }, DEV)).toBe("en-XA");
    expect(languageOfAccount({ language: "en-XA" }, PROD)).toBe("en-AU");
    expect(languageOfAccount({ language: "fr" }, DEV)).toBe("en-AU");
    expect(languageOfAccount({}, DEV)).toBe("en-AU");
    expect(languageOfAccount(null, DEV)).toBe("en-AU");
  });
});
