import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

vi.mock("../services/prisma", () => ({
  default: {
    user: { create: vi.fn(), findUnique: vi.fn() },
  },
}));

import prisma from "../services/prisma";
import { createUserForSignup, initialUsernameFor } from "./users";

const create = (prisma as unknown as { user: { create: Mock } }).user.create;
const findUnique = (prisma as unknown as { user: { findUnique: Mock } }).user
  .findUnique;

// The shape Prisma 7's pg driver adapter reports for a unique violation:
// `meta.target` is left undefined and the index is named under
// `driverAdapterError`. Probed against a real Postgres; mirroring it here is
// what keeps these tests from passing on a shape production never sends.
// Mutation: drop the `driverAdapterError` branch of `indexHas` in users.ts and
// the username-retry tests reject instead of resolving.
function p2002(index: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { driverAdapterError: { cause: { constraint: { index } } } },
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

  // Mutation: write only cognitoId (or only subject) in createUserForSignup.
  it("writes the sub to both identity columns", async () => {
    create.mockResolvedValueOnce(ROW);
    await createUserForSignup({
      sub: SUB,
      email: EMAIL,
      initialUsername: INITIAL,
    });
    expect(create.mock.calls[0][0].data).toMatchObject({
      cognitoId: SUB,
      subject: SUB,
    });
  });

  it("recovers the racing row on a subject collision", async () => {
    create.mockRejectedValueOnce(p2002("users_subject_key"));
    findUnique.mockResolvedValueOnce(ROW);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).resolves.toBe(ROW);
  });

  it("retries with a sub-suffixed username when the username is taken", async () => {
    const suffixed = { ...ROW, username: `${INITIAL}-${SUB.slice(0, 6)}` };
    create
      .mockRejectedValueOnce(p2002("users_username_key"))
      .mockResolvedValueOnce(suffixed);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).resolves.toBe(suffixed);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].data.username).toBe(
      `${INITIAL}-${SUB.slice(0, 6)}`,
    );
  });

  // "NewUser" signing up while "newuser" exists: the as-read index refuses it,
  // and that is a taken username, not a 500.
  it("retries when the collision is a case-variant username", async () => {
    const suffixed = { ...ROW, username: `${INITIAL}-${SUB.slice(0, 6)}` };
    create
      .mockRejectedValueOnce(p2002("users_username_as_read_key"))
      .mockResolvedValueOnce(suffixed);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).resolves.toBe(suffixed);
  });

  it("returns 409 when the email is owned and no same-sub row is recoverable", async () => {
    // This is the case the email pre-check in the route normally handles; here
    // it surfaces only as a race between the pre-check and the insert.
    create.mockRejectedValueOnce(p2002("users_email_key"));
    findUnique.mockResolvedValueOnce(null);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("recovers the racing row on an email collision created by the same sub", async () => {
    create.mockRejectedValueOnce(p2002("users_email_key"));
    findUnique.mockResolvedValueOnce(ROW);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).resolves.toBe(ROW);
  });

  it("recovers the racing row on a cognitoId collision (concurrent first-login)", async () => {
    // Postgres reports the cognito_id constraint (not email/username).
    create.mockRejectedValueOnce(p2002("users_cognito_id_key"));
    findUnique.mockResolvedValueOnce(ROW);
    await expect(
      createUserForSignup({ sub: SUB, email: EMAIL, initialUsername: INITIAL }),
    ).resolves.toBe(ROW);
  });

  it("escalates to a longer suffix, then recovers a racing row if all suffixes are taken", async () => {
    create
      .mockRejectedValueOnce(p2002("users_username_key"))
      .mockRejectedValueOnce(p2002("users_username_key"))
      .mockRejectedValueOnce(p2002("users_username_key"));
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

// First-login name. Mutation that turns each red: let the email's local part
// through (the local-part cases), drop the usernameSchema check (the UUID,
// email and invalid cases), or derive the fallback from the email instead of
// the sub.
describe("initialUsernameFor", () => {
  const sub = "9f1c2b3a-0000-4000-8000-000000000001";
  // sha256(sub) first 8 hex
  const neutral = `user-${createHash("sha256").update(sub).digest("hex").slice(0, 8)}`;
  const name = (username: string, email = "jane.doe@example.com") =>
    initialUsernameFor({ sub, email, username });

  it("keeps a valid name the user chose", () => {
    expect(name("canyoneer_42")).toBe("canyoneer_42");
  });
  it("is neutral for a UUID username", () => {
    expect(name("0b9f8a6e-1c2d-4e3f-8a9b-0c1d2e3f4a5b")).toBe(neutral);
  });
  it("is neutral for the email's local part, in any case", () => {
    expect(name("jane.doe")).toBe(neutral);
    expect(name("Jane.Doe")).toBe(neutral);
  });
  it("is neutral for a name containing the local part", () => {
    expect(name("jane.doe99")).toBe(neutral);
  });
  it("is neutral for the email itself", () => {
    expect(name("jane.doe@example.com")).toBe(neutral);
  });
  it("is neutral for a name that fails the username rules", () => {
    expect(name("ab")).toBe(neutral);
    expect(name("has space")).toBe(neutral);
    expect(name("x".repeat(33))).toBe(neutral);
  });
  it("never carries the email in the neutral name", () => {
    expect(neutral).toMatch(/^user-[0-9a-f]{8}$/);
    expect(neutral).not.toContain("jane");
  });
});
