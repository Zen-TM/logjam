import { describe, it, expect } from "vitest";
import request from "supertest";
import { BOB_ID, CAROL_ID, NONEXISTENT_ID } from "./_actors";

// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
// alice <-> bob are friends in the seed, so alice may share with bob.
// carol is NOT alice's friend, so sharing with carol must be forbidden.
// Each test creates its own canyon + share and tears them down, so the
// baseline seed shares (canyon 1 & 2 -> bob) are left intact.
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

async function createCanyon(name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/canyons")
    .set(AUTH)
    .send({ name, latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("sharing routes (fake auth = alice)", () => {
  it("POST share → GET shares → DELETE share round-trips for a friend", async () => {
    const canyonId = await createCanyon("CH-003 share roundtrip");
    try {
      const shareRes = await request(API_URL)
        .post(`/canyons/${canyonId}/share`)
        .set(AUTH)
        .send({ sharedWithUserId: BOB_ID });
      expect(shareRes.status).toBe(201);

      const listRes = await request(API_URL)
        .get(`/canyons/${canyonId}/shares`)
        .set(AUTH);
      expect(listRes.status).toBe(200);
      expect(
        listRes.body.some(
          (s: { sharedWith: { id: string } }) => s.sharedWith.id === BOB_ID,
        ),
      ).toBe(true);
      // Owner-only share listing must not leak the recipient's email.
      for (const share of listRes.body) {
        expect(share.sharedWith.email).toBeUndefined();
      }

      const unshareRes = await request(API_URL)
        .delete(`/canyons/${canyonId}/share/${BOB_ID}`)
        .set(AUTH);
      expect(unshareRes.status).toBe(204);

      const afterRes = await request(API_URL)
        .get(`/canyons/${canyonId}/shares`)
        .set(AUTH);
      expect(
        afterRes.body.some(
          (s: { sharedWith: { id: string } }) => s.sharedWith.id === BOB_ID,
        ),
      ).toBe(false);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  it("POST share is rejected with 403 when target is not a friend (carol)", async () => {
    const canyonId = await createCanyon("CH-003 non-friend share");
    try {
      const res = await request(API_URL)
        .post(`/canyons/${canyonId}/share`)
        .set(AUTH)
        .send({ sharedWithUserId: CAROL_ID });
      expect(res.status).toBe(403);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  it("POST share rejects a duplicate with 409", async () => {
    const canyonId = await createCanyon("CH-003 duplicate share");
    try {
      const first = await request(API_URL)
        .post(`/canyons/${canyonId}/share`)
        .set(AUTH)
        .send({ sharedWithUserId: BOB_ID });
      expect(first.status).toBe(201);

      const second = await request(API_URL)
        .post(`/canyons/${canyonId}/share`)
        .set(AUTH)
        .send({ sharedWithUserId: BOB_ID });
      expect(second.status).toBe(409);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  it("POST share 404s for a non-existent canyon", async () => {
    const res = await request(API_URL)
      .post(`/canyons/${NONEXISTENT_ID}/share`)
      .set(AUTH)
      .send({ sharedWithUserId: BOB_ID });
    expect(res.status).toBe(404);
  });

  it("POST share 400s without sharedWithUserId", async () => {
    const canyonId = await createCanyon("CH-003 missing target");
    try {
      const res = await request(API_URL)
        .post(`/canyons/${canyonId}/share`)
        .set(AUTH)
        .send({});
      expect(res.status).toBe(400);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });
});
