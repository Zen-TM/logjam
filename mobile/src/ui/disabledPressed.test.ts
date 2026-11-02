import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// shared/DESIGN.md §4 and §5, held in the kit: a disabled control stays
// pressable so a press can say why, one press feedback is `opacity.pressed`
// (or `cardPressed` on a card), a disabled row keeps its reason at full
// strength, and a switch draws the roles Logjam Web's does.
const here = new URL("./", import.meta.url);
const source = (name: string) => readFileSync(new URL(name, here), "utf8");

describe("a disabled control stays pressable", () => {
  // Mutation: write `const inactive = disabled || loading` in Button, or
  // `disabled={disabled}` on IconButton's Pressable.
  it("hands the native Pressable only `loading`, never `disabled`", () => {
    expect(source("Button.tsx")).toMatch(/const inactive = loading;/);
    expect(source("IconButton.tsx")).not.toMatch(/\n\s+disabled=\{disabled\}/);
  });

  // Mutation: put `disabled` back into `accessibilityState` on Button or
  // IconButton: TalkBack may then refuse the double-tap that shows the reason.
  it("is unavailable by its hint, not by its accessibility state", () => {
    for (const name of ["Button.tsx", "IconButton.tsx"]) {
      expect(source(name)).toContain("`Unavailable. ${disabledReason}`");
      expect(source(name)).not.toMatch(
        /accessibilityState=\{\{ disabled(: disabled| \})/,
      );
    }
  });
});

describe("one press feedback", () => {
  // Mutation: write `pressed: { opacity: 0.6 }` in IconButton.
  it("is never a literal opacity in the kit", () => {
    const offenders = readdirSync(here)
      .filter((name) => /\.tsx$/.test(name))
      .filter((name) => /opacity: 0?\.\d/.test(source(name)));
    expect(offenders).toEqual([]);
  });
});

describe("a disabled row", () => {
  // Mutation: put `disabled && styles.disabled` on `styles.subtitle`, or back
  // on the row itself.
  it("dims its tile, title and controls but not the reason line", () => {
    const row = source("Row.tsx");
    expect(row).not.toMatch(/styles\.row,[^\]]*disabled && styles\.disabled/);
    expect(row).not.toMatch(/styles\.subtitle[^\n]*disabled/);
    expect(row.match(/disabled && styles\.disabled/g)).toHaveLength(4);
  });
});

describe("a switch", () => {
  // Mutation: draw the off track in `theme.line` (1.17:1 on the card).
  it("draws the roles of Logjam Web's Toggle", () => {
    const toggle = source("Toggle.tsx");
    expect(toggle).toContain("trackOff: { backgroundColor: theme.lineStrong }");
    expect(toggle).toContain("thumbOn: { backgroundColor: theme.onFill");
  });

  // Mutation: change the role to "button", drop `checked` from the state (the
  // TalkBack "on/off"), or press without `onChange(!checked)`.
  it("is a switch that announces and flips its state", () => {
    const toggle = source("Toggle.tsx");
    expect(toggle).toContain('accessibilityRole="switch"');
    expect(toggle).toMatch(/accessibilityState=\{\{\s*checked/);
    expect(toggle).toMatch(/onChange\(!checked\)/);
  });
});

describe("a repeated disabled press", () => {
  // Mutation: drop the `REPEAT_MS` check, and Android queues a toast per tap.
  it("is not toasted again within a moment", () => {
    expect(source("disabledReason.ts")).toMatch(
      /reason === last\.reason && now - last\.at < REPEAT_MS/,
    );
  });
});
