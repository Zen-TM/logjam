import { beforeEach, describe, expect, it, vi } from "vitest";

// The `/users/me` cache is a privacy boundary as much as a battery one: the
// record it holds is a username and an email, and this phone can be handed to
// someone else. So both halves are pinned here — that it stops the eight
// screens which fetch the user on mount from each paying for a round-trip, and
// that a write to that path, or a wipe, drops it immediately.
//
// It also guards a subtler one: `GET /users/me` is what PROVISIONS the user row
// on first sign-in (`ensureUserExists`), so a cache hit on the wrong side of an
// account change would silently skip creating the new account's row.

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("../config", () => ({
  config: { apiUrl: "https://api.test", authMode: "fake" },
  CLIENT_VERSION: "0.0.0-test",
  CLIENT_VERSION_HEADER: "x-logjam-client",
}));
vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: async () => ({ tokens: { idToken: "t" } }),
}));
vi.mock("../auth/sessionErrors", () => ({
  classifySessionError: () => "transient",
}));

const { apiFetch, invalidateCurrentUser } = await import("./apiFetch");
const { isNoResponse } = await import("./noResponse");

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    clone: () => jsonResponse(body),
    headers: { get: () => null },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  invalidateCurrentUser();
});

describe("the /users/me cache", () => {
  it("serves a second read of the same record without a round-trip", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "alice" }));

    expect(await apiFetch("/users/me")).toEqual({ id: "alice" });
    expect(await apiFetch("/users/me")).toEqual({ id: "alice" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache any other path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await apiFetch("/notifications");
    await apiFetch("/notifications");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("takes a PATCH's own response as the new record", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "alice", username: "a" }),
    );
    await apiFetch("/users/me");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "alice", username: "b" }),
    );
    await apiFetch("/users/me", { method: "PATCH", body: { username: "b" } });

    // No third request, and the answer is the PATCHed record — not the stale one.
    expect(await apiFetch("/users/me")).toEqual({ id: "alice", username: "b" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops the record on a wipe, so the next account cannot read it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "alice" }));
    await apiFetch("/users/me");

    // What `wipeAllLocalData` calls on sign-out and on a different user
    // signing in.
    invalidateCurrentUser();

    fetchMock.mockResolvedValue(jsonResponse({ id: "bob" }));
    expect(await apiFetch("/users/me")).toEqual({ id: "bob" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops the record when the account is deleted", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "alice" }));
    await apiFetch("/users/me");

    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => undefined,
      clone: () => ({ json: async () => undefined }),
      headers: { get: () => null },
    });
    await apiFetch("/users/me", { method: "DELETE" });

    fetchMock.mockResolvedValue(jsonResponse({ id: "bob" }));
    expect(await apiFetch("/users/me")).toEqual({ id: "bob" });
  });
});

describe("a request that got no answer", () => {
  // The sync engine never counts these against an op (flush.ts), so the mark
  // has to be on exactly the failures where the API said nothing. Mutation:
  // drop either `markNoResponse` in apiFetch and a case here turns red; mark
  // the `!res.ok` path and the last one does.
  async function failure(): Promise<unknown> {
    return apiFetch("/sync/push", { method: "POST", body: {} }).then(
      () => null,
      (err: unknown) => err,
    );
  }

  it("marks a connection that was refused or reset", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    expect(isNoResponse(await failure())).toBe(true);
  });

  it("marks the timeout's abort", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("Aborted"), { name: "AbortError" }),
    );
    expect(isNoResponse(await failure())).toBe(true);
  });

  it("marks a reply cut off before its body arrived", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
      headers: { get: () => null },
    });
    expect(isNoResponse(await failure())).toBe(true);
  });

  it.each([502, 503, 504])(
    "does not mark a %i: the server, or what stands in front of it, answered",
    async (status) => {
      const response = {
        ok: false,
        status,
        json: async () => ({}),
        clone: () => response,
        headers: { get: () => null },
      };
      fetchMock.mockResolvedValue(response);
      const err = await failure();
      expect(isNoResponse(err)).toBe(false);
      expect((err as { status?: number }).status).toBe(status);
    },
  );
});
