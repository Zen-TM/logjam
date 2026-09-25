import { describe, expect, it } from "vitest";

import { friendListLoadKey } from "./friendListLoad";

const eligible = { active: true, available: true, loaded: false, attempt: 0 };

describe("friendListLoadKey", () => {
  it("loads once the panel is on screen and sharing is available", () => {
    expect(friendListLoadKey(eligible)).not.toBeNull();
  });

  it.each([
    ["a closed sheet asks for nothing", { active: false }],
    ["no sharing capability — a guest has no endpoint to ask", { available: false }],
    ["a list already loaded never re-fetches on its own", { loaded: true }],
    ["and none of those become eligible by retrying", { active: false, attempt: 3 }],
    ["", { available: false, attempt: 3 }],
    ["", { loaded: true, attempt: 3 }],
    ["", { active: false, available: false, loaded: true, attempt: 9 }],
  ])("issues no request: %s", (_why, override) => {
    expect(friendListLoadKey({ ...eligible, ...override })).toBeNull();
  });

  it("is stable while nothing changes, so a re-render does not re-fetch", () => {
    expect(friendListLoadKey(eligible)).toBe(friendListLoadKey({ ...eligible }));
  });

  // MAPP-007 itself: after a failed load nothing else has moved — the list is
  // still null, the sheet is still open — so the retry is the only thing that
  // can make this key differ from the one that failed.
  it("changes on every retry, which is what makes the retry a retry", () => {
    const keys = [0, 1, 2, 3].map((attempt) =>
      friendListLoadKey({ ...eligible, attempt }),
    );
    expect(new Set(keys).size).toBe(4);
    expect(keys.every((key) => key !== null)).toBe(true);
  });

  it("resumes loading when a sheet closed mid-failure is reopened", () => {
    const closed = friendListLoadKey({ ...eligible, active: false, attempt: 1 });
    const reopened = friendListLoadKey({ ...eligible, attempt: 1 });
    expect(closed).toBeNull();
    expect(reopened).not.toBeNull();
  });
});
