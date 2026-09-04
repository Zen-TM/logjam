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
    // Derived monthly-tile-usage fields are augmented onto the response.
    expect(typeof res.body.monthlyComputeUsage).toBe("number");
    expect(typeof res.body.monthlyComputeCredits).toBe("number");
    expect(typeof res.body.monthlyComputeResetAt).toBe("string");
  });

  // Regression: PATCH /me previously returned the raw Prisma row, dropping the
  // derived monthlyComputeUsage/monthlyComputeResetAt (not columns). The frontend
  // replaces its cached user with this response, so the dropped fields made the
  // Account panel render " / 40" and a full progress bar after any profile
  // update (fresh-signup consent flow being the reliable trigger).
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

  it("PATCH /users/me updates the email notification preferences and restores them", async () => {
    const keys = ["topoEmail", "exportEmail", "geoPdfEmail"] as const;
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
    expect(res.body.schemaVersion).toBe(2);
    expect(res.body.user.username).toBe("alice");
    expect(Array.isArray(res.body.canyons)).toBe(true);
    expect(Array.isArray(res.body.tripLogs)).toBe(true);
    expect(Array.isArray(res.body.media)).toBe(true);
    for (const item of res.body.media) {
      expect(typeof item.fileSizeBytes).toBe("number");
    }
  });

  // PRIV-004: privacy.html promises a "complete machine-readable JSON copy"
  // (APP 12 access). schemaVersion 2 adds the previously omitted user-owned
  // collections — topo jobs carry location-bearing footprints, so their
  // absence made "complete" inaccurate. BigInt byte fields (topoJob
  // outputBytes, topoExportJob resultBytes) must serialise via the global
  // replacer without crashing.
  it("GET /users/me/export includes topo jobs, topo exports, topo templates, and notifications (schemaVersion 2)", async () => {
    const res = await request(API_URL).get("/users/me/export").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe(2);
    expect(Array.isArray(res.body.topoJobs)).toBe(true);
    expect(Array.isArray(res.body.topoExportJobs)).toBe(true);
    expect(Array.isArray(res.body.topoTemplates)).toBe(true);
    expect(Array.isArray(res.body.notifications)).toBe(true);
    for (const job of res.body.topoJobs) {
      // footprint geometry round-trips; byte counts are plain numbers.
      expect(job).toHaveProperty("footprint");
      if (job.outputBytes != null) expect(typeof job.outputBytes).toBe("number");
    }
    for (const exportJob of res.body.topoExportJobs) {
      if (exportJob.resultBytes != null)
        expect(typeof exportJob.resultBytes).toBe("number");
    }
  });
});
