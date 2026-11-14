import { describe, it, expect } from "vitest";
import request from "supertest";

// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
// The prod-runtime half (the pseudo-language is refused there) cannot run
// against a dev stack: src/lib/requestLanguage.unit.test.ts and
// src/middleware/language.unit.test.ts hold it.
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;
const NO_SUCH_PLACE = "/places/00000000-0000-4000-8000-00000000dead";
const ENGLISH = "Couldn't find that place.";

const refusal = async (language?: string) => {
  const call = request(API_URL).get(NO_SUCH_PLACE).set(AUTH);
  const res = await (language === undefined
    ? call
    : call.set("Accept-Language", language));
  expect(res.status).toBe(404);
  return res.body.error as string;
};

describe("a refusal is written in the language the request names", () => {
  // Mutation: delete `app.use(languageForRequest)` in index.ts, and en-XA
  // comes back in English.
  it("wraps the sentence for en-XA and leaves it English for no header, fr and en-AU", async () => {
    expect(await refusal()).toBe(ENGLISH);
    expect(await refusal("fr")).toBe(ENGLISH);
    expect(await refusal("en-AU")).toBe(ENGLISH);
    const wrapped = await refusal("en-XA");
    expect(wrapped).not.toBe(ENGLISH);
    expect(wrapped.startsWith("⟦")).toBe(true);
  });

  // Mutation: keep the language in a module variable instead of
  // AsyncLocalStorage, and a request overlapping another one reads its language.
  it("does not leak between requests in flight at once", async () => {
    const languages = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0 ? "en-XA" : "en-AU",
    );
    const answers = await Promise.all(languages.map((l) => refusal(l)));
    answers.forEach((answer, i) =>
      expect(answer.startsWith("⟦")).toBe(languages[i] === "en-XA"),
    );
  });

  // Mutation: store `language` as sent, and a client can write any text into
  // the account's preferences, which a mail or push title is later written in.
  it("PATCH /users/me stores a language Logjam has and refuses one it has not", async () => {
    try {
      const ok = await request(API_URL)
        .patch("/users/me")
        .set(AUTH)
        .send({ language: "en-US" });
      expect(ok.status).toBe(200);
      expect(ok.body.uiPreferences.language).toBe("en-US");
      for (const language of ["fr", "", 7, null]) {
        const bad = await request(API_URL)
          .patch("/users/me")
          .set(AUTH)
          .send({ language });
        expect(bad.status).toBe(400);
      }
      const kept = await request(API_URL).get("/users/me").set(AUTH);
      expect(kept.body.uiPreferences.language).toBe("en-US");
    } finally {
      await request(API_URL)
        .patch("/users/me")
        .set(AUTH)
        .send({ language: "en-AU" });
    }
  });
});
