import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const alert = vi.fn();
vi.mock("react-native", () => ({ Alert: { alert } }));

const { confirm } = await import("./confirm");

const SRC = join(import.meta.dirname, "..");

// Files still to move to confirm(); delete an entry when its file moves.
// App.tsx's three-way sign-out prompt has no confirm() equivalent yet.
const BASELINE: string[] = ["../App.tsx"];
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

const appCallers = () =>
  readFileSync(join(SRC, "..", "App.tsx"), "utf8").includes("Alert.alert(")
    ? ["../App.tsx"]
    : [];

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

  // Mutation: ignore `cancelLabel`, or let any other screen pass it.
  it("draws a second step's own Cancel word only when asked, and only PeopleView asks", () => {
    confirm(copy, { cancelLabel: "Keep files" });
    expect(alert.mock.calls.at(-1)![2][0].text).toBe("Keep files");
    const askers = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return askers(path);
        return /\.tsx?$/.test(entry.name) &&
          !/\.test\./.test(entry.name) &&
          relative(SRC, path) !== "ui/confirm.ts" &&
          readFileSync(path, "utf8").includes("cancelLabel")
          ? [relative(SRC, path)]
          : [];
      });
    expect(askers(SRC)).toEqual(["plans/PeopleView.tsx"]);
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
  const found = [...callers(SRC), ...appCallers()].sort();

  it("is not called by a file the baseline does not list", () => {
    expect(found.filter((file) => !BASELINE.includes(file))).toEqual([]);
  });

  it("lists only files that still call it — the list only shrinks", () => {
    expect(BASELINE.filter((file) => !found.includes(file))).toEqual([]);
  });
});
