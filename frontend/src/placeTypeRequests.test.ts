// A request BODY is a contract with a route, and nothing here was checking it.
// `reassignPlaceType` sent `{ toPlaceTypeId }` while the route reads
// `placeTypeId` (api/src/routes/placeTypes.ts, pinned by its own integration
// test), so every attempt to move a type's places answered 400 and the type
// could never be emptied — invisibly, because the server test passed and the
// only client was never asserted against it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { reassignPlaceType } from "./placeUtils";

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => "test-token" } },
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reassignPlaceType", () => {
  it("names the destination with the key the route reads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ movedCount: 3 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await reassignPlaceType("from-id", "to-id");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/place-types/from-id/reassign");
    expect(JSON.parse(init.body as string)).toEqual({ placeTypeId: "to-id" });
  });
});
