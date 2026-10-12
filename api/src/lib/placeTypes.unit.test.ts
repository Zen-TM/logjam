import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const findMany = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock("../services/prisma", () => ({
  default: { placeType: { findMany, create, update, count: () => 0 } },
}));

const { createPlaceType, updatePlaceType } = await import("./placeTypes");

const taken = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
const CAVE = { name: "Cave", iconKey: "cave", color: "#000000" };

beforeEach(() => {
  findMany.mockReset();
  create.mockReset();
  update.mockReset();
});

// Two phones on one account each made "Cave" with no signal and push in the
// same instant: both read the name as free, and the second insert loses to the
// unique index. A push renames a taken name because a refusal parks an op the
// user can only discard, with the places made of the type.
//
// Mutation that turns the first two red: answer the lost race with a 409
// whatever the caller asked for.
describe("a place type name lost to a concurrent write", () => {
  it("is renamed on a push's create, as a name found taken is", async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "other", name: "Cave" }]);
    create
      .mockRejectedValueOnce(taken())
      .mockImplementation(({ data }) => data);

    const made = await createPlaceType("user", "type-1", CAVE, "rename");

    expect(made).toMatchObject({ id: "type-1", name: "Cave (2)" });
  });

  it("is renamed on a push's rename", async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "other", name: "Cave" }]);
    update
      .mockRejectedValueOnce(taken())
      .mockImplementation(({ data }) => data);

    const saved = await updatePlaceType(
      "user",
      { id: "type-1", name: "Grotto" },
      CAVE,
      "rename",
    );

    expect(saved).toMatchObject({ name: "Cave (2)" });
  });

  it("is still refused over REST, where the user can pick another", async () => {
    findMany.mockResolvedValue([]);
    create.mockRejectedValue(taken());

    await expect(
      createPlaceType("user", undefined, CAVE),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("gives up after one more try rather than looping", async () => {
    findMany.mockResolvedValue([]);
    create.mockRejectedValue(taken());

    await expect(
      createPlaceType("user", "type-1", CAVE, "rename"),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
