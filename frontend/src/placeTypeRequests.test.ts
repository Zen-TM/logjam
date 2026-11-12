// The reassign route reads `placeTypeId` (api/src/routes/placeTypes.ts).
import { describe, it, expect, vi, afterEach } from "vitest";
import { reassignPlaceType } from "./placeUtils";

vi.mock("./auth/oidc", () => ({
  loadSession: vi.fn().mockResolvedValue({ id_token: "test-token" }),
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
