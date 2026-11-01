import { describe, expect, it } from "vitest";

import { pushAvailable } from "./pushAvailable";

// Mutation that turns it red: drop the platform check, and the iOS dev build
// (APNs, no Firebase) loses push too; or the `.dev` check, and the real app
// does.
describe("pushAvailable", () => {
  it("is false only for the Android dev variant", () => {
    expect(pushAvailable("android", "com.logjamnsw.mobile.dev")).toBe(false);
    expect(pushAvailable("android", "com.logjamnsw.mobile")).toBe(true);
    expect(pushAvailable("ios", "com.logjamnsw.mobile.dev")).toBe(true);
    expect(pushAvailable("android", undefined)).toBe(true);
  });
});
