import { describe, it, expect } from "vitest";
import request from "supertest";
import { CURRENT_CONSENT_VERSION } from "../constants/consent";

// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
//
// NOTE: DELETE /users/me is intentionally NOT exercised here. It permanently
// wipes the authenticated user (alice) and every owned record, which would
// destroy the shared seed for all other integration tests running against the
// same local DB. The cascade-delete + S3 cleanup path it drives is covered by
// reading the route and by CH-002 (s3Cleanup now throws on failure); a
// dedicated destructive test would need an isolated throwaway user, which fake
// auth (always alice) cannot impersonate. See code-health-unaddressed.md.
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
  });

  it("PATCH /users/me rejects an empty update body", async () => {
    const res = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
  });

  it("PATCH /users/me rejects an invalid username", async () => {
    const res = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ username: "no spaces allowed!" });
    expect(res.status).toBe(400);
  });

  it("PATCH /users/me rejects an invalid themeSchemeId", async () => {
    const res = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ themeSchemeId: "not-a-real-scheme" });
    expect(res.status).toBe(400);
  });

  it("PATCH /users/me updates a notification preference and restores it", async () => {
    const before = await request(API_URL).get("/users/me").set(AUTH);
    const original: boolean = before.body.uiPreferences.notifications.topoEmail;

    const toggled = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ notifications: { topoEmail: !original } });
    expect(toggled.status).toBe(200);
    expect(toggled.body.uiPreferences.notifications.topoEmail).toBe(!original);

    // Restore so the seed user is left as found.
    const restore = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ notifications: { topoEmail: original } });
    expect(restore.status).toBe(200);
    expect(restore.body.uiPreferences.notifications.topoEmail).toBe(original);
  });

  // Consent boundary (PRIV-002): the server is the integrity half of the
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

  it("GET /users/me/export returns the caller's data with bigint fields as numbers", async () => {
    const res = await request(API_URL).get("/users/me/export").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe(1);
    expect(res.body.user.username).toBe("alice");
    expect(Array.isArray(res.body.canyons)).toBe(true);
    expect(Array.isArray(res.body.tripLogs)).toBe(true);
    expect(Array.isArray(res.body.media)).toBe(true);
    for (const item of res.body.media) {
      expect(typeof item.fileSizeBytes).toBe("number");
    }
  });
});
