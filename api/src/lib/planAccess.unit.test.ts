import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: { tripPlanMember: { findUnique: vi.fn() } },
}));

import { say } from "@logjam/shared";
import prisma from "../services/prisma";
import type { Prisma } from "@prisma/client";
import {
  canChangeItem,
  casMissed,
  touchPlan,
  requirePlanMember,
  requirePlanRole,
  requirePlanWrite,
} from "./planAccess";

const findUnique = (
  prisma as unknown as { tripPlanMember: { findUnique: Mock } }
).tripPlanMember.findUnique;

const PLAN = { id: "plan-1", createdById: "u-lead", archivedAt: null };

function membership(
  status: string,
  role = "member",
  archivedAt: Date | null = null,
) {
  return { id: "m-1", role, status, plan: { ...PLAN, archivedAt } };
}

async function statusOf(promise: Promise<unknown>): Promise<number | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { statusCode: number }).statusCode;
  }
}

beforeEach(() => findUnique.mockReset());

// The plan boundary: only an active member is in. Someone never in it,
// invited, or asking to join gets the 404 a missing plan gets, so the answer
// is no oracle for plan ids (ADR 0002). Mutation that turns it red: drop the
// `status !== "active"` check in requirePlanMember.
describe("requirePlanMember", () => {
  it.each([
    ["never in it", null],
    ["invited", membership("invited", "leader")],
    ["asking to join", membership("requested")],
  ])("404s for someone %s", async (_who, row) => {
    findUnique.mockResolvedValue(row);
    await expect(statusOf(requirePlanMember("u-1", "plan-1"))).resolves.toBe(
      404,
    );
  });

  it.each(["leader", "editor", "member"])(
    "lets an active %s in",
    async (role) => {
      findUnique.mockResolvedValue(membership("active", role));
      await expect(requirePlanMember("u-1", "plan-1")).resolves.toEqual({
        plan: PLAN,
        role,
        memberId: "m-1",
      });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { planId_userId: { planId: "plan-1", userId: "u-1" } },
        }),
      );
    },
  );

  it("refuses a role it doesn't know rather than treating it as any", async () => {
    findUnique.mockResolvedValue(membership("active", "owner"));
    await expect(statusOf(requirePlanMember("u-1", "plan-1"))).resolves.toBe(
      500,
    );
  });
});

describe("requirePlanWrite", () => {
  it("409s on an archived plan, still 404s a non-member", async () => {
    findUnique.mockResolvedValue(membership("active", "leader", new Date()));
    await expect(statusOf(requirePlanWrite("u-1", "plan-1"))).resolves.toBe(
      409,
    );
    findUnique.mockResolvedValue(membership("requested", "member", new Date()));
    await expect(statusOf(requirePlanWrite("u-1", "plan-1"))).resolves.toBe(
      404,
    );
  });
});

describe("roles", () => {
  const access = (role: "leader" | "editor" | "member") => ({
    plan: PLAN,
    role,
    memberId: "m-1",
  });

  // Mutation: change requirePlanRole's 403 to any other status.
  it("403s a role not in the list", async () => {
    const forbidden = say`Only a leader can archive this plan.`;
    expect(() =>
      requirePlanRole(access("editor"), ["leader"], forbidden),
    ).toThrow(forbidden);
    await expect(
      statusOf(
        (async () =>
          requirePlanRole(access("member"), ["leader"], forbidden))(),
      ),
    ).resolves.toBe(403);
    expect(() =>
      requirePlanRole(access("editor"), ["leader", "editor"], forbidden),
    ).not.toThrow();
  });

  it("lets a member change only what they added", () => {
    const theirs = { addedById: "u-2" };
    expect(canChangeItem(access("member"), { addedById: "u-1" }, "u-1")).toBe(
      true,
    );
    expect(canChangeItem(access("member"), theirs, "u-1")).toBe(false);
    expect(canChangeItem(access("member"), { addedById: null }, "u-1")).toBe(
      false,
    );
    expect(canChangeItem(access("editor"), theirs, "u-1")).toBe(true);
    expect(canChangeItem(access("leader"), theirs, "u-1")).toBe(true);
  });
});

// Both 404 paths answer a DELETE that landed after the access check.
describe("touchPlan", () => {
  // Mutation: drop touchPlan's count === 0 throw (a section create then hits
  // the plan's foreign key: a 500).
  it("404s a plan deleted meanwhile", async () => {
    const tx = { tripPlan: { updateMany: async () => ({ count: 0 }) } };
    await expect(
      statusOf(touchPlan(tx as unknown as Prisma.TransactionClient, "plan-1")),
    ).resolves.toBe(404);
    const live = { tripPlan: { updateMany: async () => ({ count: 1 }) } };
    await expect(
      statusOf(
        touchPlan(live as unknown as Prisma.TransactionClient, "plan-1"),
      ),
    ).resolves.toBe("ok");
  });
});

describe("casMissed", () => {
  // Mutation: answer 409 whatever the count.
  it("is 404 when the plan has gone, 409 when it moved", async () => {
    const db = (n: number) => ({ tripPlan: { count: async () => n } });
    expect((await casMissed(db(0), "plan-1")).statusCode).toBe(404);
    expect((await casMissed(db(1), "plan-1")).statusCode).toBe(409);
  });
});
