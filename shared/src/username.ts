import { say } from "./userSentence.js";

/** The username rule: the API enforces it, and a client checks it before asking. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const USERNAME_RULE = say`A username is 3 to 32 letters, numbers, dots, dashes or underscores.`;

export const USERNAME_TAKEN = say`That username is taken. Choose another.`;

export function isValidUsername(value: string): boolean {
  const v = value.trim();
  return (
    v.length >= USERNAME_MIN &&
    v.length <= USERNAME_MAX &&
    USERNAME_PATTERN.test(v)
  );
}
