import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import prisma from "../services/prisma";
import { ALICE_ID, BOB_ID, NONEXISTENT_ID } from "./_actors";

// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
// Each test creates its own notification rows directly via Prisma (the API
// has no "create notification" endpoint — notifications are emitted as a
// side effect of other routes) and tears them down afterwards, so the
// baseline seed notifications (if any) are left intact.
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

describe("GET /notifications (fake auth = alice)", () => {
  it("drops a canyon_shared notification whose referenced canyon no longer exists (PRIV-001)", async () => {
    const notification = await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "canyon_shared",
        payload: { canyonId: NONEXISTENT_ID, sharedById: BOB_ID },
        read: false,
      },
    });
    try {
      const res = await request(API_URL).get("/notifications").set(AUTH);
      expect(res.status).toBe(200);
      expect(
        res.body.some((n: { id: string }) => n.id === notification.id),
      ).toBe(false);
    } finally {
      await prisma.notification.deleteMany({ where: { id: notification.id } });
    }
  });

  it("drops a friend_request notification whose referenced friendship no longer exists (PRIV-001)", async () => {
    const notification = await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "friend_request",
        payload: { friendshipId: NONEXISTENT_ID },
        read: false,
      },
    });
    try {
      const res = await request(API_URL).get("/notifications").set(AUTH);
      expect(res.status).toBe(200);
      expect(
        res.body.some((n: { id: string }) => n.id === notification.id),
      ).toBe(false);
    } finally {
      await prisma.notification.deleteMany({ where: { id: notification.id } });
    }
  });

  it("resolves canyonName and sharedByUsername for a live canyon_shared notification", async () => {
    const canyon = await prisma.canyon.create({
      data: {
        ownerId: ALICE_ID,
        name: "CH-002 notification canyon",
        latitude: -33.7,
        longitude: 150.3,
      },
    });
    const notification = await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "canyon_shared",
        payload: { canyonId: canyon.id, sharedById: BOB_ID },
        read: false,
      },
    });
    try {
      const res = await request(API_URL).get("/notifications").set(AUTH);
      expect(res.status).toBe(200);
      const found = res.body.find((n: { id: string }) => n.id === notification.id);
      expect(found).toBeDefined();
      expect(found.payload.canyonName).toBe("CH-002 notification canyon");
      expect(found.payload.sharedByUsername).toBe("bob");
    } finally {
      await prisma.notification.deleteMany({ where: { id: notification.id } });
      await prisma.canyon.delete({ where: { id: canyon.id } });
    }
  });

  it("orders unread notifications before read ones, newest first within each group", async () => {
    const older = await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "topo_complete",
        payload: { jobId: "job-older" },
        read: false,
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    const newer = await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "topo_complete",
        payload: { jobId: "job-newer" },
        read: false,
        createdAt: new Date(),
      },
    });
    const readOne = await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "topo_complete",
        payload: { jobId: "job-read" },
        read: true,
        createdAt: new Date(),
      },
    });
    try {
      const res = await request(API_URL).get("/notifications").set(AUTH);
      expect(res.status).toBe(200);
      const ids = res.body.map((n: { id: string }) => n.id);
      const newerIdx = ids.indexOf(newer.id);
      const olderIdx = ids.indexOf(older.id);
      const readIdx = ids.indexOf(readOne.id);
      expect(newerIdx).toBeGreaterThanOrEqual(0);
      expect(olderIdx).toBeGreaterThan(newerIdx);
      expect(readIdx).toBeGreaterThan(olderIdx);
    } finally {
      await prisma.notification.deleteMany({
        where: { id: { in: [older.id, newer.id, readOne.id] } },
      });
    }
  });
});

describe("PATCH /notifications/:id/read and DELETE /notifications/:id (fake auth = alice)", () => {
  it("404s for a non-existent notification id", async () => {
    const patchRes = await request(API_URL)
      .patch(`/notifications/${NONEXISTENT_ID}/read`)
      .set(AUTH);
    expect(patchRes.status).toBe(404);

    const deleteRes = await request(API_URL)
      .delete(`/notifications/${NONEXISTENT_ID}`)
      .set(AUTH);
    expect(deleteRes.status).toBe(404);
  });

  it("403s when the notification belongs to another user", async () => {
    const bobNotification = await prisma.notification.create({
      data: {
        userId: BOB_ID,
        type: "topo_complete",
        payload: { jobId: "bobs-job" },
        read: false,
      },
    });
    try {
      const patchRes = await request(API_URL)
        .patch(`/notifications/${bobNotification.id}/read`)
        .set(AUTH);
      expect(patchRes.status).toBe(403);

      const deleteRes = await request(API_URL)
        .delete(`/notifications/${bobNotification.id}`)
        .set(AUTH);
      expect(deleteRes.status).toBe(403);

      // Confirm bob's notification was untouched.
      const after = await prisma.notification.findUnique({ where: { id: bobNotification.id } });
      expect(after?.read).toBe(false);
    } finally {
      await prisma.notification.deleteMany({ where: { id: bobNotification.id } });
    }
  });

  it("marks an owned notification read, then deletes it", async () => {
    const notification = await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "topo_complete",
        payload: { jobId: "alices-job" },
        read: false,
      },
    });
    try {
      const patchRes = await request(API_URL)
        .patch(`/notifications/${notification.id}/read`)
        .set(AUTH);
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.read).toBe(true);

      const deleteRes = await request(API_URL)
        .delete(`/notifications/${notification.id}`)
        .set(AUTH);
      expect(deleteRes.status).toBe(204);

      const after = await prisma.notification.findUnique({ where: { id: notification.id } });
      expect(after).toBeNull();
    } finally {
      await prisma.notification.deleteMany({ where: { id: notification.id } });
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
