import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ThemePreferencesProvider,
  useThemePreferences,
} from "./themePreferences";

const api = vi.hoisted(() => ({ fetchUser: vi.fn() }));
vi.mock("./placeUtils", () => ({
  fetchCurrentUser: api.fetchUser,
  updateCurrentUserThemeScheme: vi.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemePreferencesProvider>{children}</ThemePreferencesProvider>
);

function osIs(mode: "light" | "dark") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark") === (mode === "dark"),
  }));
}

async function hydrated(uiPreferences: unknown) {
  api.fetchUser.mockResolvedValue({ uiPreferences });
  const hook = renderHook(() => useThemePreferences(), { wrapper });
  await act(() => hook.result.current.hydrateFromUser());
  return hook.result.current.schemeId;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Mutation: have `hydrateFromUser` read `normalizeUserUiPreferences(...)
// .themeSchemeId` again and the first case goes red.
describe("the scheme before the user has picked one", () => {
  it("follows a light OS when the account holds no pick", async () => {
    osIs("light");
    expect(await hydrated({ notifications: {} })).toBe("ghostGum");
  });

  it("follows a dark OS when the account holds no pick", async () => {
    osIs("dark");
    expect(await hydrated({})).toBe("sandstone");
  });

  it("keeps the pick whatever the OS says", async () => {
    osIs("light");
    expect(await hydrated({ themeSchemeId: "basalt" })).toBe("basalt");
  });
});
