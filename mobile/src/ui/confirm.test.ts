import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const alert = vi.fn();
vi.mock("react-native", () => ({ Alert: { alert } }));

const { confirm } = await import("./confirm");

const SRC = join(import.meta.dirname, "..");

const callers = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return callers(path);
    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|d)\./.test(entry.name) &&
      relative(SRC, path) !== "ui/confirm.ts" &&
      readFileSync(path, "utf8").includes("Alert.alert(")
      ? [relative(SRC, path)]
      : [];
  });

describe("confirm", () => {
  beforeEach(() => alert.mockReset());

  const copy = {
    confirmTitle: "Delete this place?",
    confirmBody: "Its photos go too.",
    confirmLabel: "Delete",
    tone: "destructive",
  } as const;

  // Mutation: label the first button "Keep it".
  it("always draws Cancel, then the verb in the tone's style", () => {
    confirm(copy);
    const [title, body, buttons, options] = alert.mock.calls[0];
    expect([title, body]).toEqual(["Delete this place?", "Its photos go too."]);
    expect(buttons.map((b: { text: string }) => b.text)).toEqual([
      "Cancel",
      "Delete",
    ]);
    expect(buttons.map((b: { style: string }) => b.style)).toEqual([
      "cancel",
      "destructive",
    ]);
    expect(options.cancelable).toBe(true);
    confirm({ ...copy, tone: "filled" });
    expect(alert.mock.calls[1][2][1].style).toBe("default");
  });

  it("resolves true on the verb and false on Cancel or a dismissal", async () => {
    const press = (index: number) => {
      const done = confirm(copy);
      alert.mock.calls.at(-1)![2][index].onPress();
      return done;
    };
    expect(await press(1)).toBe(true);
    expect(await press(0)).toBe(false);
    const dismissed = confirm(copy);
    alert.mock.calls.at(-1)![3].onDismiss();
    expect(await dismissed).toBe(false);
  });
});

// Every Alert goes through confirm(), so Cancel is always "Cancel"
// (mobile/DESIGN.md §4). Mutation: add `Alert.alert(` to any screen.
describe("Alert.alert is called only by confirm()", () => {
  it("is not called by any other file", () => {
    expect(callers(SRC).sort()).toEqual([]);
  });
});
