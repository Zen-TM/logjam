import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("../services/prisma", () => ({
  default: {
    user: { create: vi.fn(), findUnique: vi.fn() },
  },
}));

import prisma from "../services/prisma";
import { createUserForSignup } from "./users";

const create = (prisma as unknown as { user: { create: Mock } }).user.create;
const findUnique = (prisma as unknown as { user: { findUnique: Mock } }).user
  .findUnique;

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

const SUB = "abcdef0123456789-new";
const EMAIL = "new@example.com";
const INITIAL = "newuser";
const ROW = { id: "u1", cognitoId: SUB, email: EMAIL, username: INITIAL };

beforeEach(() => {
  create.mockReset();
  findUnique.mockReset();
});

describe("createUserForSignup", () => {
  it("creates with the initial username when nothing collides", async () => {
    create.mockResolvedValueOnce(ROW);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).resolves.toBe(ROW);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.username).toBe(INITIAL);
  });

  it("retries with a sub-suffixed username when the username is taken", async () => {
    const suffixed = { ...ROW, username: `${INITIAL}-${SUB.slice(0, 6)}` };
    create
      .mockRejectedValueOnce(p2002(["username"]))
      .mockResolvedValueOnce(suffixed);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).resolves.toBe(suffixed);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].data.username).toBe(
      `${INITIAL}-${SUB.slice(0, 6)}`,
    );
  });

  it("returns 409 when the email is owned and no same-sub row is recoverable", async () => {
    // This is the case the email pre-check in the route normally handles; here
    // it surfaces only as a race between the pre-check and the insert.
    create.mockRejectedValueOnce(p2002(["email"]));
    findUnique.mockResolvedValueOnce(null);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("recovers the racing row on an email collision created by the same sub", async () => {
    create.mockRejectedValueOnce(p2002(["email"]));
    findUnique.mockResolvedValueOnce(ROW);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).resolves.toBe(ROW);
  });

  it("recovers the racing row on a cognitoId collision (concurrent first-login)", async () => {
    // Postgres reports the cognito_id constraint (not email/username).
    create.mockRejectedValueOnce(p2002(["cognito_id"]));
    findUnique.mockResolvedValueOnce(ROW);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).resolves.toBe(ROW);
  });

  it("escalates to a longer suffix, then recovers a racing row if all suffixes are taken", async () => {
    create
      .mockRejectedValueOnce(p2002(["username"]))
      .mockRejectedValueOnce(p2002(["username"]))
      .mockRejectedValueOnce(p2002(["username"]));
    findUnique.mockResolvedValueOnce(ROW);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).resolves.toBe(ROW);
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[2][0].data.username).toBe(
      `${INITIAL}-${SUB.slice(0, 12)}`,
    );
  });

  it("rethrows non-P2002 errors unchanged", async () => {
    const boom = new Error("connection reset");
    create.mockRejectedValueOnce(boom);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).rejects.toBe(boom);
  });
});
