import { describe, expect, it, vi } from "vitest";

import { ErrorState, ListBody, LoadingState } from "./ScreenStates";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Text: "Text",
  View: "View",
}));
vi.mock("../theme", () => ({
  spacing: () => 0,
  makeStyles: () => () => ({}),
  useTheme: () => ({}),
  withAlpha: () => "",
  muted: () => ({}),
}));
vi.mock("./Button", () => ({ Button: "Button" }));
vi.mock("./Icon", () => ({ Icon: "Icon" }));

// A failed load never draws the empty state (shared/DESIGN.md §11). Mutation
// that turns it red: return `empty ?? children` before checking `failed`.
describe("ListBody", () => {
  const body = (state: "loading" | "failed" | "ready", empty?: string) =>
    ListBody({ state, error: "Couldn't load.", empty, children: "the list" });

  it("draws the error, not the empty state, for a failed load", () => {
    const element = body("failed", "Add your first place");
    expect(element.type).toBe(ErrorState);
    expect(element.props.message).toBe("Couldn't load.");
  });

  it("draws loading, then the empty state, else the list", () => {
    expect(body("loading").type).toBe(LoadingState);
    expect(body("ready", "Add your first place").props.children).toBe(
      "Add your first place",
    );
    expect(body("ready").props.children).toBe("the list");
  });
});
