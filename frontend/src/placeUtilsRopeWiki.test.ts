import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyRopeWikiImport,
  importFromRopeWiki,
  refreshFromRopeWiki,
} from "./placeUtils";

vi.mock("./auth/oidc", () => ({
  loadSession: async () => ({ id_token: "t" }),
}));

afterEach(() => vi.unstubAllGlobals());

// Mutation: drop the region from any one of the three paths (the server then
// reads absent as NSW), or stop encoding it.
describe("the RopeWiki calls name their region", () => {
  it.each([
    ["import", () => importFromRopeWiki("nz"), "/ropewiki/import?region=nz"],
    [
      "apply",
      () => applyRopeWikiImport("nz", []),
      "/ropewiki/import/apply?region=nz",
    ],
    ["refresh", () => refreshFromRopeWiki("nz"), "/ropewiki/refresh?region=nz"],
    [
      "an id with a reserved character",
      () => refreshFromRopeWiki("a&b"),
      "/ropewiki/refresh?region=a%26b",
    ],
  ])("%s", async (_name, call, path) => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    await call();
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url.endsWith(path)).toBe(true);
  });
});
