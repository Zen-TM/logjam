import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { answerConfirm, confirm, pendingConfirm } from "./confirm";

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
      readFileSync(path, "utf8").includes("Alert.alert(")
      ? [relative(SRC, path)]
      : [];
  });

const appCallers = () =>
  readFileSync(join(SRC, "..", "App.tsx"), "utf8").includes("Alert.alert(")
    ? ["../App.tsx"]
    : [];

describe("confirm", () => {
  const copy = {
    confirmTitle: "Delete this place?",
    confirmBody: "Its photos go too.",
    confirmLabel: "Delete",
    tone: "destructive",
  } as const;

  afterEach(() => {
    while (pendingConfirm()) answerConfirm(false);
  });

  // Mutation: resolve the verb with false, or Cancel with true.
  it("resolves true on the verb and false on Cancel or a dismissal", async () => {
    const asked = confirm(copy);
    expect(pendingConfirm()?.copy).toBe(copy);
    answerConfirm(true);
    expect(await asked).toBe(true);
    const cancelled = confirm(copy);
    answerConfirm(false);
    expect(await cancelled).toBe(false);
    expect(pendingConfirm()).toBeUndefined();
  });

  // Mutation: show the second confirm over the first.
  it("shows one at a time, in the order asked", async () => {
    const first = confirm(copy);
    const second = confirm({ ...copy, confirmTitle: "Second?" });
    expect(pendingConfirm()?.copy.confirmTitle).toBe("Delete this place?");
    answerConfirm(true);
    expect(await first).toBe(true);
    expect(pendingConfirm()?.copy.confirmTitle).toBe("Second?");
    answerConfirm(false);
    expect(await second).toBe(false);
  });

  // Mutation: ignore `cancelLabel`, or let any other screen pass it.
  it("draws a second step's own Cancel word only when asked, and only PeopleView asks", () => {
    void confirm(copy);
    expect(pendingConfirm()?.cancelLabel).toBe("Cancel");
    answerConfirm(false);
    void confirm(copy, { cancelLabel: "Keep files" });
    expect(pendingConfirm()?.cancelLabel).toBe("Keep files");
    const askers = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return askers(path);
        return /\.tsx?$/.test(entry.name) &&
          !/\.test\./.test(entry.name) &&
          relative(SRC, path) !== "ui/confirm.ts" &&
          relative(SRC, path) !== "ConfirmHost.tsx" &&
          readFileSync(path, "utf8").includes("cancelLabel")
          ? [relative(SRC, path)]
          : [];
      });
    expect(askers(SRC)).toEqual(["plans/PeopleView.tsx"]);
  });
});

// Every confirm goes through confirm(), so Cancel is always "Cancel"
// (mobile/DESIGN.md §4), and none is a white OS alert on a dark map.
// Mutation: add `Alert.alert(` to any screen.
describe("Alert.alert is called only by confirm()", () => {
  const found = [...callers(SRC), ...appCallers()].sort();

  it("is not called by a file the baseline does not list", () => {
    expect(found.filter((file) => !BASELINE.includes(file))).toEqual([]);
  });

  it("lists only files that still call it — the list only shrinks", () => {
    expect(BASELINE.filter((file) => !found.includes(file))).toEqual([]);
  });
});

// A confirm nothing draws never resolves, and the verb it guards hangs.
// Mutation: remove `<ConfirmHost />` from AppShell.
describe("ConfirmHost", () => {
  it("is mounted by the shell", () => {
    expect(readFileSync(join(SRC, "AppShell.tsx"), "utf8")).toContain(
      "<ConfirmHost />",
    );
  });
});
