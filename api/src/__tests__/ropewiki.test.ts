import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, as, CAROL_SUB } from "./_actors";

// routes/ropewiki.ts: only the validation paths of POST /ropewiki/import/apply,
// which run before any RopeWiki fetch. /import and /refresh download the CSV
// from ropewiki.com, so they are not exercised here. Sent as carol because
// ropeWikiHeavyLimiter allows 5 requests per 5 minutes per user. No
// unauthenticated-401 case: fake auth treats a missing header as alice.
describe("POST /ropewiki/import/apply validation", () => {
  it("rejects an empty decisions array with 400", async () => {
    const res = await request(API_URL)
      .post("/ropewiki/import/apply")
      .set(as(CAROL_SUB))
      .send({ decisions: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a link decision without targetPlaceId with 400", async () => {
    const res = await request(API_URL)
      .post("/ropewiki/import/apply")
      .set(as(CAROL_SUB))
      .send({ decisions: [{ ropeWikiId: 1, action: "link" }] });
    expect(res.status).toBe(400);
  });
});
