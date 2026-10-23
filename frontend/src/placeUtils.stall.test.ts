// putToPresignedUrl's stall timeout: a PUT that sends nothing for stallMs is
// aborted, so a dead connection fails the attempt rather than hanging it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { putToPresignedUrl } from "./placeUtils";

vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: vi.fn() }));

/** An XHR whose send never progresses or loads; abort fires onabort. */
class SilentXhr {
  upload: { onprogress?: () => void } = {};
  onabort?: () => void;
  onloadend?: () => void;
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {
    this.onabort?.();
    this.onloadend?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("putToPresignedUrl", () => {
  // Mutation: drop arm() (or its setTimeout), and the PUT waits forever.
  it("rejects a PUT that sends nothing for stallMs", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", SilentXhr);
    const put = putToPresignedUrl("u", new Blob(["x"]), null, undefined, 1000);
    const settled = put.then(
      () => "resolved",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(999);
    let state = "pending";
    void settled.then((s) => {
      state = s;
    });
    await Promise.resolve();
    expect(state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toBe("Upload stalled");
  });
});
