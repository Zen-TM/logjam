import { describe, it, expect } from "vitest";
import request from "supertest";
import { CURRENT_CONSENT_VERSION } from "../constants/consent";
import { MAX_SLOPE_BANDS } from "@logjam/shared";

// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
//
// NOTE: DELETE /users/me is intentionally NOT exercised here. It permanently
// wipes the authenticated user (alice) and every owned record, which would
// destroy the shared seed for all other integration tests running against the
// same local DB. The cascade-delete + S3 cleanup path it drives is covered by
// unit tests (s3Cleanup throws on failure); a dedicated destructive test would
// need an isolated throwaway user, which fake auth (always alice) cannot
// impersonate.
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

describe("users routes (fake auth = alice)", () => {
  it("GET /users/me returns the profile with normalized numeric storage fields", async () => {
    const res = await request(API_URL).get("/users/me").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("alice");
    // serializeUserForResponse converts BigInt storage to Number.
    expect(typeof res.body.storageUsedBytes).toBe("number");
    expect(typeof res.body.storageQuotaBytes).toBe("number");
    // uiPreferences is normalized into the canonical shape.
    expect(res.body.uiPreferences).toBeTruthy();
    expect(typeof res.body.uiPreferences.themeSchemeId).toBe("string");
    expect(res.body.uiPreferences.notifications).toBeTruthy();
    // Derived monthly-tile-usage fields are augmented onto the response.
    expect(typeof res.body.monthlyComputeUsage).toBe("number");
    expect(typeof res.body.monthlyComputeCredits).toBe("number");
    expect(typeof res.body.monthlyComputeResetAt).toBe("string");
  });

  // PATCH /users/me must include the derived monthlyComputeUsage and
  // monthlyComputeResetAt (not DB columns), because the frontend replaces its
  // cached user with this response.
  it("PATCH /users/me returns the derived monthly-tile-usage fields", async () => {
    const before = await request(API_URL).get("/users/me").set(AUTH);
    const res = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ themeSchemeId: before.body.uiPreferences.themeSchemeId });
    expect(res.status).toBe(200);
    expect(typeof res.body.monthlyComputeUsage).toBe("number");
    expect(typeof res.body.monthlyComputeCredits).toBe("number");
    expect(typeof res.body.monthlyComputeResetAt).toBe("string");
  });

  it("PATCH /users/me rejects an empty update body", async () => {
    const res = await request(API_URL).patch("/users/me").set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  it("PATCH /users/me rejects an invalid username", async () => {
    const res = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ username: "no spaces allowed!" });
    expect(res.status).toBe(400);
  });

  // When a chosen username is already taken, the refusal must inform the user
  // rather than returning a generic conflict error.
  // Mutation: answer a P2002 by `meta.target` again.
  it("PATCH /users/me says a taken username is taken", async () => {
    const res = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ username: "bob" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("That username is taken. Choose another.");
  });

  // Two usernames that differ only in case are one username (issue #360):
  // `users_username_as_read_key` holds the lower-case form. Mutation: drop the
  // index and this rename succeeds, taking alice's username off the seed.
  it("PATCH /users/me refuses a username that differs only in case", async () => {
    try {
      const res = await request(API_URL)
        .patch("/users/me")
        .set(AUTH)
        .send({ username: "Bob" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("That username is taken. Choose another.");
    } finally {
      // Under the mutation above the rename lands; the export test later in
      // this file expects "alice" back.
      await request(API_URL)
        .patch("/users/me")
        .set(AUTH)
        .send({ username: "alice" });
    }
  });

  it("PATCH /users/me rejects an invalid themeSchemeId", async () => {
    const res = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ themeSchemeId: "not-a-real-scheme" });
    expect(res.status).toBe(400);
  });

  it("PATCH /users/me stores a retired scheme id as the scheme it became, and restores", async () => {
    const before = await request(API_URL).get("/users/me").set(AUTH);
    const original = before.body.uiPreferences.themeSchemeId;
    try {
      const res = await request(API_URL)
        .patch("/users/me")
        .set(AUTH)
        .send({ themeSchemeId: "ironbark" });
      expect(res.status).toBe(200);
      expect(res.body.uiPreferences.themeSchemeId).toBe("scribblyGum");
    } finally {
      await request(API_URL)
        .patch("/users/me")
        .set(AUTH)
        .send({ themeSchemeId: original });
    }
  });

  it("PATCH /users/me updates the email notification preferences and restores them", async () => {
    const keys = ["topoEmail", "exportEmail"] as const;
    const before = await request(API_URL).get("/users/me").set(AUTH);
    const original: Record<string, boolean> = Object.fromEntries(
      keys.map((k) => [k, before.body.uiPreferences.notifications[k]]),
    );

    const flipped = Object.fromEntries(keys.map((k) => [k, !original[k]]));
    const toggled = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ notifications: flipped });
    expect(toggled.status).toBe(200);
    for (const k of keys) {
      expect(toggled.body.uiPreferences.notifications[k]).toBe(!original[k]);
    }

    // Restore so the seed user is left as found.
    const restore = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ notifications: original });
    expect(restore.status).toBe(200);
    for (const k of keys) {
      expect(restore.body.uiPreferences.notifications[k]).toBe(original[k]);
    }
  });

  it("PATCH /users/me stores the user's slope bands, and restores", async () => {
    const before = await request(API_URL).get("/users/me").set(AUTH);
    const original = before.body.uiPreferences.slopeBands;
    expect(original.length).toBeGreaterThan(0);
    const bands = [
      { fromDeg: 30, toDeg: 45, colour: "#ffff00ff" },
      { fromDeg: 45, toDeg: 90, colour: "#ff0000ff" },
    ];
    try {
      const res = await request(API_URL)
        .patch("/users/me")
        .set(AUTH)
        .send({ slopeBands: bands });
      expect(res.status).toBe(200);
      expect(res.body.uiPreferences.slopeBands).toEqual(bands);
    } finally {
      await request(API_URL)
        .patch("/users/me")
        .set(AUTH)
        .send({ slopeBands: original });
    }
  });

  // Mutation: store the body's bands without `parseSlopeBands`, and a band
  // MapLibre cannot draw reaches both clients' maps.
  it("PATCH /users/me rejects slope bands the editor would not accept", async () => {
    for (const slopeBands of [
      [],
      [{ fromDeg: 40, toDeg: 30, colour: "#ff0000ff" }],
      [{ fromDeg: 40, toDeg: 50, colour: "red" }],
    ]) {
      const res = await request(API_URL)
        .patch("/users/me")
        .set(AUTH)
        .send({ slopeBands });
      expect(res.status).toBe(400);
    }
  });

  // Mutation: drop the length check before `parseSlopeBands`, and an
  // over-long list is a 400 checked element by element.
  it("PATCH /users/me answers too many slope bands with 413", async () => {
    const slopeBands = Array.from({ length: MAX_SLOPE_BANDS + 1 }, (_, i) => ({
      fromDeg: i * 10,
      toDeg: i * 10 + 10,
      colour: "#ff0000ff",
    }));
    const res = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ slopeBands });
    expect(res.status).toBe(413);
  });

  // Consent boundary: the server is the integrity half of the
  // re-consent mechanism — it must reject any consentVersion other than the
  // current constant, and must expose consentVersion so the client gate
  // (frontend needsReconsent/ConsentGate) can fire after a version bump.
  it("PATCH /users/me rejects a consentVersion that is not the current constant", async () => {
    const res = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ consentVersion: "2020-01-01" });
    expect(res.status).toBe(400);
  });

  it("PATCH /users/me records the current consent version and sets consentedAt", async () => {
    const res = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ consentVersion: CURRENT_CONSENT_VERSION });
    expect(res.status).toBe(200);
    expect(res.body.consentVersion).toBe(CURRENT_CONSENT_VERSION);
    expect(res.body.consentedAt).toBeTruthy();
  });

  it("GET /users/me echoes consentVersion so the client re-consent gate can fire", async () => {
    const res = await request(API_URL).get("/users/me").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("consentVersion");
  });

  it("GET /users/me names the current consent version so a build need not bake it", async () => {
    const res = await request(API_URL).get("/users/me").set(AUTH);
    expect(res.body.currentConsentVersion).toBe(CURRENT_CONSENT_VERSION);
  });

  it("GET /users/me/export returns the caller's data with bigint fields as numbers", async () => {
    const res = await request(API_URL).get("/users/me/export").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe(3);
    expect(res.body.user.username).toBe("alice");
    expect(Array.isArray(res.body.places)).toBe(true);
    expect(Array.isArray(res.body.tripLogs)).toBe(true);
    expect(Array.isArray(res.body.media)).toBe(true);
    for (const item of res.body.media) {
      expect(typeof item.fileSizeBytes).toBe("number");
    }
  });

  // privacy.html promises a "complete machine-readable JSON copy" (APP 12
  // access). Topo jobs carry location-bearing footprints, so they must be
  // included in the export. BigInt byte fields (topoJob outputBytes,
  // topoExportJob resultBytes) must serialise via the global replacer without
  // crashing.
  it("GET /users/me/export includes topo jobs, topo exports, topo templates, and notifications (schemaVersion 2)", async () => {
    const res = await request(API_URL).get("/users/me/export").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe(3);
    expect(Array.isArray(res.body.topoJobs)).toBe(true);
    expect(Array.isArray(res.body.topoExportJobs)).toBe(true);
    expect(Array.isArray(res.body.topoTemplates)).toBe(true);
    expect(Array.isArray(res.body.notifications)).toBe(true);
    for (const job of res.body.topoJobs) {
      // footprint geometry round-trips; byte counts are plain numbers.
      expect(job).toHaveProperty("footprint");
      if (job.outputBytes != null)
        expect(typeof job.outputBytes).toBe("number");
    }
    for (const exportJob of res.body.topoExportJobs) {
      if (exportJob.resultBytes != null)
        expect(typeof exportJob.resultBytes).toBe("number");
    }
  });

  // schemaVersion 3: every section in lib/dataExport.ts reaches the response,
  // and another user appears by username only, never by email.
  it("GET /users/me/export carries every v3 section, with no other user's email", async () => {
    const res = await request(API_URL).get("/users/me/export").set(AUTH);
    expect(res.status).toBe(200);
    for (const section of [
      "placeTypes",
      "customFieldDefs",
      "placeLinks",
      "routes",
      "friendships",
      "itemSharesGiven",
      "itemSharesReceived",
      "fileSendsSent",
      "fileSendsReceived",
      "devices",
    ]) {
      expect(Array.isArray(res.body[section]), section).toBe(true);
    }
    for (const friendship of res.body.friendships) {
      expect(friendship.requester).not.toHaveProperty("email");
      expect(friendship.addressee).not.toHaveProperty("email");
    }
  });
});
