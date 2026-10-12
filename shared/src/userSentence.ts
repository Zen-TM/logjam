// A sentence written for the person using Logjam. The API's `AppError` takes
// nothing else, so a string cannot reach a response unless `say` made it, and
// `api/src/userCopy.unit.test.ts` holds every `say` to the copy rules.

declare const userSentence: unique symbol;

/** Text a client may show as it is. Only `say` makes one. */
export type UserSentence = string & { readonly [userSentence]: true };

/** The user's own words (a name, a label) inside a sentence. */
export type Quoted = { readonly quoted: string };

/**
 * Put the user's own words in a sentence. They are set in “ ”, which is how
 * `withoutQuoted` finds them again: a log line never carries a label or a name.
 */
export function quote(text: string): Quoted {
  return { quoted: text };
}

/**
 * Write a user sentence: say`Couldn't find that place.`
 *
 * A hole takes a number, another sentence, or `quote(theirWords)`. A bare
 * string is refused by the type: it is how a field key, an id or an error's
 * message would get in.
 */
export function say(
  strings: TemplateStringsArray,
  ...holes: (number | UserSentence | Quoted)[]
): UserSentence {
  let text = strings[0];
  holes.forEach((hole, index) => {
    text +=
      typeof hole === "object"
        ? `“${hole.quoted.trim().replace(/[“”]/g, '"')}”`
        : String(hole);
    text += strings[index + 1];
  });
  return text as UserSentence;
}

/** A sentence with the user's own words taken out, for a log line. */
export function withoutQuoted(sentence: string): string {
  return sentence.replace(/“[^”]*”/g, "“…”");
}

/** For a request only a bug in a client, or a hand-made request, can send. */
export const MALFORMED_REQUEST_SENTENCE = say`That didn't work because of a fault in Logjam, not something you did.`;

/** For a failure on our side that trying again may get past. */
export const SERVER_FAULT_SENTENCE = say`Something went wrong on our end. Please try again.`;
