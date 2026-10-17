import { describe, expect, it } from "vitest";
import request from "supertest";
import { PLACE_SEARCH_API_PATH } from "@logjam/shared";

import { ALICE_SUB, API_URL, as } from "./_actors";

// POST /places/search, end to end against the running API.
//
// Requires `make dev`, whose seed publishes the shared fixture
// (shared/src/__fixtures__/place-registry.json) as the registry in MiniStack's
// topo bucket before the API starts. The API reads it in the background and
// looks again every five minutes, so a stack whose API started before the seed
// answers 503 here until then.

describe("POST /places/search", () => {
  it("answers from the registry, best first", async () => {
    const res = await request(API_URL)
      .post(PLACE_SEARCH_API_PATH)
      .set(as(ALICE_SUB))
      .send({ q: "katoomba falls" });
    expect(res.status).toBe(200);
    expect(res.body.version).toEqual(expect.any(String));
    expect(res.body.results.map((r: { name: string }) => r.name)).toEqual([
      "Katoomba Falls",
      "Katoomba Falls Road",
      "Katoomba Falls Inn",
    ]);
  });

  it("answers nothing for a query too short to rank", async () => {
    const res = await request(API_URL)
      .post(PLACE_SEARCH_API_PATH)
      .set(as(ALICE_SUB))
      .send({ q: "k" });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it("refuses a body without a query", async () => {
    const res = await request(API_URL)
      .post(PLACE_SEARCH_API_PATH)
      .set(as(ALICE_SUB))
      .send({});
    expect(res.status).toBe(400);
  });
});
