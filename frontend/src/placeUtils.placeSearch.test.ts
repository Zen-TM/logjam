// Location search on the wire: the query and the region whose registry
// answers ride the body, never the URL, which the API's access log keeps.
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPlaceRegistry } from "./placeUtils";

vi.mock("./auth/oidc", () => ({ loadSession: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("searchPlaceRegistry", () => {
  // Mutation: leave `region` out of the body, and the API answers every map
  // from the default region's registry; move `q` or `region` into the URL,
  // and the access log keeps what the user typed.
  it("sends the query and the region in the body, never the URL", async () => {
    // Fake auth, as `make dev` has it: CI has no session to load.
    vi.stubEnv("VITE_AUTH_MODE", "fake");
    const sent = vi.fn<
      (url: string, init: { body?: string }) => Promise<Response>
    >(async () => new Response(JSON.stringify({ results: [], version: "v" })));
    vi.stubGlobal("fetch", sent);

    await searchPlaceRegistry(
      "Hidden Gorge",
      8,
      new AbortController().signal,
      "elsewhere",
    );

    const [url, init] = sent.mock.calls[0];
    expect(url).toMatch(/\/places\/search$/);
    expect(JSON.parse(init.body ?? "{}")).toEqual({
      q: "Hidden Gorge",
      limit: 8,
      region: "elsewhere",
    });
  });
});
