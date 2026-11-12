// `replaces` on the wire: the old track's id rides the presign and the confirm
// of an upload, and the link of an import, so the API can swap them in one step.
import { describe, it, expect, vi, afterEach } from "vitest";
import { linkMediaToPlace, uploadMedia } from "./placeUtils";

vi.mock("./auth/oidc", () => ({ loadSession: vi.fn() }));

class OkXhr {
  upload = {};
  status = 200;
  onload?: () => void;
  onloadend?: () => void;
  open() {}
  setRequestHeader() {}
  send() {
    this.onload?.();
    this.onloadend?.();
  }
}

const calls: { url: string; body: Record<string, unknown> }[] = [];

function stubApi() {
  calls.length = 0;
  // Fake auth, as `make dev` has it: CI has no session to load.
  vi.stubEnv("VITE_AUTH_MODE", "fake");
  vi.stubGlobal("XMLHttpRequest", OkXhr);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body?: string }) => {
      calls.push({
        url: String(url),
        body: init.body ? JSON.parse(init.body) : {},
      });
      const reply = String(url).endsWith("/presign")
        ? { mediaId: "new", displayUploadUrl: "u", thumbnailUploadUrl: null }
        : { id: "new" };
      return new Response(JSON.stringify(reply), { status: 200 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const upload = (replaces?: string) =>
  uploadMedia({
    linkedType: "place",
    linkedId: "p",
    file: new File(["x"], "route.gpx"),
    mediaType: "application/gpx+xml",
    thumbnail: null,
    replaces,
  });

describe("replaces on the wire", () => {
  // Mutation: leave `replaces` out of the confirm body (or the presign's), and
  // the API answers 409 to the upload or never swaps the old file out.
  it("sends the replaced id on the presign and the confirm", async () => {
    stubApi();
    await upload("old");
    const sent = calls.filter((c) => c.url.match(/presign|confirm/));
    expect(sent).toHaveLength(2);
    for (const call of sent) expect(call.body.replaces).toBe("old");
  });

  it("sends none when nothing is replaced", async () => {
    stubApi();
    await upload();
    for (const call of calls) expect(call.body).not.toHaveProperty("replaces");
  });

  // Mutation: drop `replaces` from the link body, and an import moved onto a
  // place that holds an upload is refused with 409.
  it("sends the replaced id on a link, and none on an unlink", async () => {
    stubApi();
    await linkMediaToPlace("imp", "p", "old");
    expect(calls[0].body).toEqual({
      linkedType: "place",
      linkedId: "p",
      replaces: "old",
    });
    await linkMediaToPlace("imp", null);
    expect(calls[1].body).toEqual({ linkedType: "none" });
  });
});
