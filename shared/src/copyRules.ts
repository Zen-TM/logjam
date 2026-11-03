// The copy rules of shared/DESIGN.md §12 that a machine can check (the
// glossary and the error register among them), declared once for both clients. `copyRules.test.ts` holds every string in
// `contracts/` and in each client's JSX to them; a hit is fixed, or listed in
// the test's allow-list with the reason it is legitimate.
import type * as TypeScript from "typescript";

export type CopyRule = {
  id: string;
  /** Matches the words the rule forbids. */
  pattern: RegExp;
  /** What to write instead, in the message a failing test prints. */
  say: string;
};

export const COPY_RULES: readonly CopyRule[] = [
  {
    id: "retry",
    pattern: /\bretry\b/i,
    say: 'Say "Try again", and only where trying again can help.',
  },
  {
    id: "the-app",
    pattern: /\bthe (?:web )?app\b/i,
    say: "Name the surface: Logjam Web or Logjam GPS.",
  },
  {
    id: "basemap",
    pattern: /\bbase ?maps?\b/i,
    say: 'Say "map" or "map data", never "basemap".',
  },
  {
    id: "tiles",
    pattern: /\btiles?\b/i,
    say: 'Say "map" or "map data", never "tiles".',
  },
  {
    id: "the-server",
    pattern: /\bthe server\b/i,
    say: 'Say what failed in our words ("Couldn\'t reach Logjam"), not where it ran.',
  },
  {
    id: "please",
    pattern: /\bplease\b/i,
    say: 'Name what failed: "Couldn\'t save this place." Add "Try again." only where it can help; never "Please".',
  },
  {
    id: "cannot",
    pattern: /\bcannot\b/i,
    say: 'Contractions: "can\'t".',
  },
  {
    id: "that-didnt-work",
    pattern: /\bthat (?:action )?didn['’]t work\b/i,
    say: 'Name what failed: "Couldn\'t {verb} {the thing}."',
  },
  {
    id: "curly-apostrophe",
    pattern: /[’‘]|&[lr]squo;/,
    say: "A straight apostrophe: '.",
  },
  { id: "waypoint", pattern: /\bwaypoints?\b/i, say: 'Say "place".' },
  {
    id: "custom-field",
    pattern: /\bcustom fields?\b/i,
    say: 'Say "attribute".',
  },
  {
    id: "logbook",
    pattern: /\blog ?books?\b/i,
    say: 'Say "trips" or "your trips".',
  },
  {
    id: "trip-log",
    pattern: /\btrip logs?\b/i,
    say: 'Say "trip"; the verb is "Log a trip".',
  },
  { id: "activity", pattern: /\bactivit(?:y|ies)\b/i, say: 'Say "trip type".' },
  {
    id: "lidar-topo",
    pattern:
      /\bLiDAR (?:topos?|overlays?)\b|(?<!\b(?:OSM|Cycle|Maps) )\btopos?\b/i,
    say: 'A sharpen job\'s result is a "sharpened area"; "LiDAR map" where either kind is meant.',
  },
  {
    id: "region",
    pattern: /\b(?:map )?regions?\b/i,
    say: 'Say "offline map"; the verb is "Save an offline map".',
  },
  {
    id: "unshare",
    pattern: /\bunshar(?:e|es|ed|ing)\b/i,
    say: 'The owner "Stop sharing"; a sharee "Remove from my account"; a friend "Remove friend".',
  },
  {
    id: "recipients",
    pattern: /\brecipients?\b/i,
    say: 'Say "friends you pick" (sharePromise).',
  },
  {
    id: "turn-down",
    pattern: /\bturn(?:ed)? down\b|\blet in\b/i,
    say: 'Answer an offer "Accept" or "Decline" (a plan invite: "Join" or "Decline").',
  },
  {
    id: "attach-to-place",
    pattern: /\battach(?:ed)? to (?:a|this) place\b/i,
    say: 'Say "Link to a place" / "Unlink from this place".',
  },
];

/** Two or more plain Capitalised Words: a Title Case label. Sentence case is
 *  the rule (§12). A word with an inner capital (GeoPDFs, LiDAR) or all
 *  capitals (GPS) is a name or an acronym, and is not one of these words. */
const TITLE_CASE = /^[A-Z][a-z’']+(?: [A-Z][a-z’']+)+$/;

export const TITLE_CASE_SAY = 'Sentence case: "Mark all as read".';

/** The ids of the rules `text` breaks (`title-case` for a Title Case label). */
export function copyViolations(text: string): string[] {
  const hits = COPY_RULES.filter((rule) => rule.pattern.test(text)).map(
    (rule) => rule.id,
  );
  // A surface's name is capitalised in a sentence-case line.
  const words = text.trim().replace(/\bLogjam (?:Web|GPS)\b/g, "x");
  if (TITLE_CASE.test(words)) hits.push("title-case");
  return hits;
}

/** What each rule id asks for, for a failure message. */
export function copySay(id: string): string {
  return id === "title-case"
    ? TITLE_CASE_SAY
    : id === "not-a-sentence"
      ? "A sentence starts with a capital and ends with a full stop."
      : ([...COPY_RULES, ...API_SENTENCE_RULES].find((rule) => rule.id === id)
          ?.say ?? "");
}

/**
 * What a sentence the API sends must also keep (§11): it is read by a person,
 * on either client, so it carries no word of ours. Checked on the literal parts
 * of every say`…` by `api/src/userCopy.unit.test.ts`.
 */
export const API_SENTENCE_RULES: readonly CopyRule[] = [
  {
    id: "names-a-client",
    pattern: /\bLogjam (?:Web|GPS)\b/,
    say: "The API cannot know which client is asking: name neither.",
  },
  {
    id: "field-key",
    pattern: /\b[a-z]+(?:[A-Z]|_[a-z])\w*|[[\]{}<>]/,
    say: "No field key, op path or code: say it in the user's words.",
  },
  {
    id: "developer-wording",
    pattern:
      /\b(?:must be|is required|are required|invalid|uuid\w*|ids?|payload|header|array|string|boolean|integer|null|undefined|param(?:eter)?s?|endpoint|request body)\b/i,
    say: 'Say what is wrong and what to do ("A trip needs a date."), not what the request failed.',
  },
];

/**
 * The rule ids a sentence the API sends breaks. `text` is the whole sentence,
 * with each hole of its template written as "…".
 */
export function apiSentenceViolations(text: string): string[] {
  const hits = [
    ...copyViolations(text),
    ...API_SENTENCE_RULES.filter((rule) => rule.pattern.test(text)).map(
      (rule) => rule.id,
    ),
  ];
  if (!/^[A-Z“…]/.test(text) || !/[.?!]$/.test(text))
    hits.push("not-a-sentence");
  return hits;
}

/**
 * A client reading INTO the API's sentence (§11): searching it, comparing it,
 * cutting it up. It is shown as it is; a client that needs to tell two
 * refusals apart asks for a status or a field, never for words.
 */
const READS_SERVER_SENTENCE =
  /\bserverMessage\s*(?:\?\.|\.)\s*(?:includes|match|startsWith|endsWith|indexOf|search|split|replace|slice|toLowerCase)\b|\bserverMessage\s*[!=]==?\s*["'`]/;

/** The lines of a client source file that parse the API's sentence. */
export function serverSentenceParses(source: string): number[] {
  return source
    .split("\n")
    .flatMap((line, index) =>
      READS_SERVER_SENTENCE.test(line) ? [index + 1] : [],
    );
}

/** JSX attributes and object properties whose string is words a user reads. */
const COPY_PROPS = new Set([
  "label",
  "title",
  "subtitle",
  "description",
  "hint",
  "placeholder",
  "message",
  "accessibilityLabel",
  "accessibilityHint",
  "aria-label",
  "emptyTitle",
  "emptyBody",
  "body",
  "note",
  "confirmTitle",
  "confirmBody",
  "caption",
]);

/**
 * The strings in a source file that a user reads: JSX text, a JSX attribute
 * named in `COPY_PROPS`, and an object property named in it. A template's
 * `${}` holes' own strings are read, their code is not. Not every user-facing string is one of these (a
 * `throw new Error("…")` reaches the user through a screen that may reword it),
 * which is why the net is words, not files: a miss is a gap in the net, never a
 * licence.
 */
export function userFacingStrings(
  /** The caller's `typescript` module. Typed loosely: each package pins its
   *  own version, and their `Node` types do not unify. */
  tsModule: unknown,
  fileName: string,
  source: string,
): { line: number; text: string }[] {
  const ts = tsModule as typeof TypeScript;
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: { line: number; text: string }[] = [];
  // Every string literal and template part anywhere under the value: a `??`
  // fallback, a ternary branch, a `+` and a `${}` hole's own strings are all
  // read by the user, so none may hide from the net. A call's arguments are
  // not: `friendShareVerb("unshare")` passes an id, and the words it returns
  // are declared where the call's callee is.
  const stringsOf = (node: TypeScript.Node): string[] => {
    const parts: string[] = [];
    const collect = (n: TypeScript.Node): void => {
      if (ts.isCallExpression(n)) return;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
        parts.push(n.text);
      else if (
        ts.isTemplateHead(n) ||
        ts.isTemplateMiddle(n) ||
        ts.isTemplateTail(n)
      )
        parts.push(n.text);
      ts.forEachChild(n, collect);
    };
    collect(node);
    return parts.filter((part) => part.trim() !== "");
  };
  const visit = (node: TypeScript.Node): void => {
    let texts: string[] = [];
    if (ts.isJsxText(node)) texts = [node.text.trim()];
    else if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      COPY_PROPS.has(node.name.getText())
    ) {
      const init = node.initializer;
      texts = stringsOf(
        ts.isJsxExpression(init) && init.expression ? init.expression : init,
      );
    } else if (
      ts.isPropertyAssignment(node) &&
      COPY_PROPS.has(node.name.getText().replace(/["']/g, ""))
    )
      texts = stringsOf(node.initializer);
    for (const text of texts)
      if (text)
        found.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          text,
        });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
