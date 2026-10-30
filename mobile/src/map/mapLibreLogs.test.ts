import { describe, expect, it, vi } from "vitest";

import { isHarmlessMapLog } from "./mapLibreLogs";

vi.mock("@maplibre/maplibre-react-native", () => ({ LogManager: {} }));

// Mutation that turns it red: match on the tag ("Render") instead of the
// message, and every render error goes quiet.
describe("isHarmlessMapLog", () => {
  it("drops the S9's missing-anisotropy line and nothing else", () => {
    expect(
      isHarmlessMapLog({
        message:
          "{RenderThread 17}[Render]: Feature not available: samplerAnisotropy",
      }),
    ).toBe(true);
    expect(
      isHarmlessMapLog({
        message: "{RenderThread 17}[Render]: Failed to create swapchain",
      }),
    ).toBe(false);
  });
});
