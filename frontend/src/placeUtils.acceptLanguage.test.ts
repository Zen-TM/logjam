import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  apiFetchBlob,
  apiFetchBlobStreamed,
  apiFetchWithTotal,
} from "./placeUtils";

vi.mock("./auth/oidc", () => ({
  loadSession: vi.fn(async () => ({ id_token: "t" })),
}));

const languageOf = globalThis as { LOGJAM_LANGUAGE?: string };

afterEach(() => {
  vi.unstubAllGlobals();
  delete languageOf.LOGJAM_LANGUAGE;
});

function respond() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    blob: async () => new Blob(["x"]),
    headers: { get: () => null },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentLanguage(fetchMock: ReturnType<typeof respond>): unknown {
  const init = (fetchMock.mock.calls[0] as unknown[])[1] as {
    headers: Record<string, string>;
  };
  return init.headers["Accept-Language"];
}

// The API writes each refusal in the language its request names. Mutation: drop
// `"Accept-Language"` from `authHeaders` in placeUtils.ts, or send one of the
// four fetchers without `authHeaders`, and that fetcher's refusals come back in
// English whatever language Logjam Web runs in.
describe("the language the API writes its refusals in", () => {
  it.each([
    ["apiFetch", () => apiFetch("/places")],
    ["apiFetchWithTotal", () => apiFetchWithTotal("/places")],
    ["apiFetchBlob", () => apiFetchBlob("/places")],
    [
      "apiFetchBlobStreamed",
      () => apiFetchBlobStreamed("/places", {}, () => undefined),
    ],
  ])("is the one Logjam Web runs in, from %s", async (_name, call) => {
    languageOf.LOGJAM_LANGUAGE = "en-US";
    const fetchMock = respond();
    await call();
    expect(sentLanguage(fetchMock)).toBe("en-US");
  });
});
