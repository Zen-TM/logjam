// The forms' source, read as text: Android autofill and the screen's privacy
// rules hang on props and lines no renderer-free test can reach otherwise.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SIGN_IN_COPY } from "@logjam/shared";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "AccountForms.tsx"), "utf8");
const fields = [...source.matchAll(/<TextField\b[\s\S]*?\/>/g)].map(([m]) => m);
const label = (field: string) => /label="([^"]+)"/.exec(field)?.[1] ?? "";

describe("AccountForms", () => {
  it("reads its fields at all", () => {
    expect(fields.length).toBeGreaterThanOrEqual(7);
  });

  // Mutation: delete `secureTextEntry` from a password TextField.
  it("hides every password as it is typed", () => {
    const passwords = fields.filter(
      (f) =>
        /password/i.test(label(f)) || /autoComplete="[a-z-]*password"/.test(f),
    );
    expect(passwords.length).toBeGreaterThanOrEqual(3);
    for (const f of passwords) expect(f).toContain("secureTextEntry");
  });

  // Mutation: set the sign-in field's autoComplete to "new-password".
  it("tells autofill which password is being asked for", () => {
    const signIn = fields.find((f) => label(f) === "Password")!;
    const fresh = fields.filter((f) => f.includes('"new-password"'));
    expect(fresh).toHaveLength(2);
    expect(signIn).toContain('autoComplete="current-password"');
    expect(signIn).toContain('textContentType="password"');
    for (const f of fields.filter((f) =>
      /^(New password|Confirm password)$/.test(label(f)),
    ))
      expect(f).toContain('autoComplete="new-password"');
  });

  // Mutation: drop `codeNeeded`: the code would be accepted, then an empty
  // password sent. Or move the clear out of `finally`: a throw would keep it.
  it("clears a sent password, unless an unconfirmed account's code is due", () => {
    const signInWith = /const signInWith =[\s\S]*?\n {2}};/.exec(source)![0];
    expect(signInWith).toMatch(/codeNeeded = true;\s+setSignedUpUsername/);
    expect(signInWith).toMatch(
      /finally \{[\s\S]*if \(!codeNeeded\) clearPasswords\(\);/,
    );
  });

  // Mutation: console.error the password, or write it to a store.
  it("never logs or stores a password", () => {
    expect(source).not.toMatch(/console\.[a-z]+\([^)]*assword/);
    expect(source).not.toMatch(/AsyncStorage|SecureStore|setItem|Keychain/);
  });
});

// Mutation: type "Create account" (or any value of `SIGN_IN_COPY`) back into
// AccountForms.tsx or ConsentGate.tsx: the two clients then word it alone.
describe("the sign-in words", () => {
  const consent = readFileSync(join(__dirname, "ConsentGate.tsx"), "utf8");
  it.each(
    Object.values(SIGN_IN_COPY).filter(
      (words) => words !== SIGN_IN_COPY.signIn,
    ),
  )("draws %s from the shared copy", (words) => {
    expect(source).not.toContain(`"${words}"`);
    expect(consent).not.toContain(`"${words}"`);
  });
});
