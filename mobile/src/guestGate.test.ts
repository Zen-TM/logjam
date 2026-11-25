import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Guards for mobile/AGENTS.md "A guest syncs nothing yet: gate a new server
// call through auth/capabilities.ts so a guest makes none" (ADR 0007) and "a
// region-of-interest bbox never reaches our API" (ADR 0036).
//
// Every file that can reach our API is declared below with how a guest is kept
// out of it. A file that starts calling the API fails until someone writes down
// that gate: that is the decision the rule asks for. Behavioural proof that a
// guest makes no call lives with the gate: `capabilities.test.ts` (the matrix),
// `shellTriggers.test.ts` (no sync, plans poll or topo download),
// `notifications/pushRegistration.test.ts` (no push token).
//
// Mutations that turn it red:
//  - `import { apiFetch } from "../api/apiFetch"` in any file not listed in
//    API_CLIENT_USERS, or a `fetch(` call in a file not listed in RAW_FETCH.
//  - `?bbox=${…}` (or a `bbox` body field) in any path or body that an
//    `apiFetch` call sends.
//  - Calling `registerForPushNotifications()` without the account state.

const SRC = __dirname;

type Entry = { file: string; gate: string; why: string };

/** Files that import `api/apiFetch`: the authenticated client. */
const API_CLIENT_USERS: Entry[] = [
  {
    file: "api/fileSends.ts",
    gate: "wrapper",
    why: "its callers are the inbox and sharing screens, gated by the `inbox` and `sharing` capabilities",
  },
  {
    file: "api/foreignFields.ts",
    gate: "wrapper",
    why: "read for a place someone else shared, which a guest cannot have",
  },
  {
    file: "api/friends.ts",
    gate: "wrapper",
    why: "its callers are the Friends screens, gated by the `friends` capability",
  },
  {
    file: "api/queries.ts",
    gate: "wrapper",
    why: "the account query is enabled only when not a guest (AppShell `useApiQuery(…, !isGuest)`); notification calls sit behind the `inbox` capability",
  },
  {
    file: "api/shares.ts",
    gate: "wrapper",
    why: "its callers are the sharing screens, gated by the `sharing` capability",
  },
  {
    file: "api/apiFetch.ts",
    gate: "the client",
    why: "a guest has no session, so it makes no request",
  },
  {
    file: "auth/deleteAccount.ts",
    gate: "linked-only screen",
    why: "called from the linked Account screen; a guest gets GuestAccountScreen",
  },
  {
    file: "auth/finishSignIn.ts",
    gate: "sign-in flow",
    why: "runs after a sign-in, which a guest has not done",
  },
  {
    file: "auth/useAuth.ts",
    gate: "no call",
    why: "only installs the session-rejected handler",
  },
  {
    file: "map/completedOverlays.ts",
    gate: "capability",
    why: "`lidarOverlays`, checked by MapScreen and RegionDownloadScreen before they call it",
  },
  {
    file: "map/placeSearch.ts",
    gate: "capability",
    why: "`placeSearch`, checked in this file",
  },
  {
    file: "map/slopeBandsPreference.ts",
    gate: "guest check",
    why: "returns early unless the account is signed in",
  },
  {
    file: "map/useElevationProfile.ts",
    gate: "guest check",
    why: "`isGuest` is passed to planElevationSources, which refuses the network",
  },
  {
    file: "notifications/pushRegistration.ts",
    gate: "capability",
    why: "`pushNotifications`; pushRegistration.test.ts holds it",
  },
  {
    file: "offline/topoAutoDownload.ts",
    gate: "shell triggers",
    why: "registered only for a linked account (shellTriggers.test.ts)",
  },
  {
    file: "offline/wipeLocalData.ts",
    gate: "no call",
    why: "only drops the cached account record",
  },
  {
    file: "plans/plansApi.ts",
    gate: "wrapper",
    why: 'the plans screens use `capabilityScreenBlock("plans")`, and the poll is a shell trigger',
  },
  {
    file: "regionsPreference.ts",
    gate: "guest check",
    why: "the `signedIn` argument: a guest keeps it on the phone",
  },
  {
    file: "saved/SavedScreen.tsx",
    gate: "capability",
    why: "`lidarOverlays`, checked in this file",
  },
  {
    file: "screens/AccountScreen.tsx",
    gate: "linked-only screen",
    why: "the guest branch returns GuestAccountScreen before any call",
  },
  {
    file: "screens/settings/DisplaySettingsScreen.tsx",
    gate: "guest check",
    why: 'returns early when `accountState === "guest"`',
  },
  {
    file: "screens/settings/NotificationSettingsScreen.tsx",
    gate: "capability",
    why: "`serverPrefs`, checked in this file",
  },
  {
    file: "screens/settings/PrivacySettingsScreen.tsx",
    gate: "capability",
    why: "`serverPrefs`, checked in this file",
  },
  {
    file: "sharing/rememberedCopyMedia.ts",
    gate: "guest check",
    why: '`accountState !== "guest"` before it reads the account',
  },
  {
    file: "sync/deltaPull.ts",
    gate: "shell triggers",
    why: "the sync engine never starts for a guest (shellTriggers.test.ts)",
  },
  {
    file: "sync/flush.ts",
    gate: "shell triggers",
    why: "the sync engine never starts for a guest (shellTriggers.test.ts)",
  },
  {
    file: "sync/mediaCache.ts",
    gate: "shell triggers",
    why: "the thumbnail pass runs in the sync cycle; a viewer opening media with no cached copy reaches `ensureDisplayCached`, where a guest's call fails closed in apiFetch (no session)",
  },
  {
    file: "sync/mediaUpload.ts",
    gate: "shell triggers",
    why: "the sync engine never starts for a guest (shellTriggers.test.ts)",
  },
  {
    file: "tracks/trackClimb.ts",
    gate: "shell triggers",
    why: "runs in the sync cycle (`upgradeTrackClimbs`), which never starts for a guest",
  },
];

/** Files that call the global `fetch` (or expo's): none goes through apiFetch. */
const RAW_FETCH: Entry[] = [
  {
    file: "api/apiFetch.ts",
    gate: "the client",
    why: "the one place that sends our API a request",
  },
  {
    file: "auth/oidcSession.ts",
    gate: "sign-in flow",
    why: "talks to the identity provider, not our API",
  },
  {
    file: "useMinVersionGate.ts",
    gate: "public",
    why: "GET /meta/min-mobile-version: no auth, no user data",
  },
  {
    file: "gauges/gaugeFeed.ts",
    gate: "public",
    why: "the river-gauge file on the public CDN",
  },
  {
    file: "offline/demLookup.ts",
    gate: "public",
    why: "public elevation tiles",
  },
  {
    file: "offline/placeRegistry.ts",
    gate: "public",
    why: "the place registry on the public CDN (ADR 0034)",
  },
  {
    file: "offline/regionDownloads.ts",
    gate: "public",
    why: "range reads of the map archive on the CDN; the clip is cut on the phone (ADR 0036)",
  },
  {
    file: "offline/regionTileDownload.ts",
    gate: "public",
    why: "raster tiles from the basemap provider",
  },
];

/** Files whose API calls may mention a bbox, with why. Empty: none may. */
const BBOX_ALLOWED: Entry[] = [];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
      ? [path]
      : [];
  });
}

const files = sources(SRC).map((path) => ({
  path,
  rel: relative(SRC, path),
  tree: ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  ),
}));

function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

const importsApiFetch = (tree: ts.SourceFile) =>
  tree.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      /(^|\/)apiFetch$/.test(s.moduleSpecifier.text),
  );

const callsRawFetch = (tree: ts.SourceFile) => {
  let found = false;
  walk(tree, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      (n.expression.text === "fetch" || n.expression.text === "expoFetch")
    ) {
      found = true;
    }
  });
  return found;
};

const names = (entries: Entry[]) => entries.map((e) => e.file).sort();

describe("what can reach our API", () => {
  const declared = (entries: Entry[], what: string) => {
    for (const e of entries) {
      expect(e.why.length, `${e.file}: say why in \`why\``).toBeGreaterThan(15);
      expect(e.gate.length, e.file).toBeGreaterThan(0);
    }
    expect(new Set(names(entries)).size, `${what}: duplicate entry`).toBe(
      entries.length,
    );
  };

  it("lists every importer of the authenticated client", () => {
    declared(API_CLIENT_USERS, "API_CLIENT_USERS");
    const found = files
      .filter((f) => f.rel === "api/apiFetch.ts" || importsApiFetch(f.tree))
      .map((f) => f.rel)
      .sort();
    // 28 importers and the client itself today: a matcher that stops finding
    // them cannot pass.
    expect(found.length).toBeGreaterThanOrEqual(25);
    expect(
      found,
      "A file that imports api/apiFetch must be declared in API_CLIENT_USERS (guestGate.test.ts) with how a guest is kept out: gate the call through auth/capabilities.ts, or name the existing gate. A guest syncs nothing (ADR 0007). Remove an entry whose file no longer imports it.",
    ).toEqual(names(API_CLIENT_USERS));
  });

  it("lists every caller of fetch", () => {
    declared(RAW_FETCH, "RAW_FETCH");
    const found = files
      .filter((f) => callsRawFetch(f.tree))
      .map((f) => f.rel)
      .sort();
    expect(found.length).toBeGreaterThanOrEqual(7);
    expect(
      found,
      "A file that calls fetch() must be declared in RAW_FETCH (guestGate.test.ts): say what host it talks to and why a guest may. A call to our own API goes through apiFetch and auth/capabilities.ts instead (ADR 0007).",
    ).toEqual(names(RAW_FETCH));
  });

  it("reads config.apiUrl in the client and the two pre-account calls only", () => {
    const found = files
      .filter((f) => {
        let reads = false;
        walk(f.tree, (n) => {
          if (
            ts.isPropertyAccessExpression(n) &&
            n.getText() === "config.apiUrl"
          )
            reads = true;
        });
        return reads;
      })
      .map((f) => f.rel)
      .sort();
    expect(
      found,
      "Only api/apiFetch.ts, api/queries.ts (the sign-up username check) and useMinVersionGate.ts may build a URL on our API's base; everything else goes through apiFetch so a guest has no session to send (ADR 0007).",
    ).toEqual(["api/apiFetch.ts", "api/queries.ts", "useMinVersionGate.ts"]);
  });

  it("registers push tokens through the account-state gate", () => {
    const calls: { rel: string; args: string[] }[] = [];
    for (const f of files) {
      walk(f.tree, (n) => {
        if (
          ts.isCallExpression(n) &&
          n.expression.getText() === "registerForPushNotifications"
        ) {
          calls.push({ rel: f.rel, args: n.arguments.map((a) => a.getText()) });
        }
      });
    }
    expect(calls).toEqual([{ rel: "AppShell.tsx", args: ["accountState"] }]);
  });
});

describe("a region-of-interest bbox", () => {
  const BBOX = /bbox|\b(west|south|east|north)\b/i;

  /** Names and string text inside `node`: not comments. */
  function words(node: ts.Node): string[] {
    const out: string[] = [];
    walk(node, (n) => {
      if (ts.isIdentifier(n)) out.push(n.text);
      else if (ts.isStringLiteralLike(n)) out.push(n.text);
      else if (
        ts.isTemplateHead(n) ||
        ts.isTemplateMiddle(n) ||
        ts.isTemplateTail(n)
      )
        out.push(n.text);
    });
    return out;
  }

  const enclosingFunction = (node: ts.Node): ts.Node => {
    for (let n = node.parent; n; n = n.parent) {
      if (
        ts.isFunctionLike(n) &&
        !ts.isSourceFile(n) &&
        // A `useEffect` callback is a function but not the unit that builds
        // the request: climb to the component or hook around it.
        !(
          ts.isCallExpression(n.parent) &&
          /^(React\.)?use\w+$/.test(n.parent.expression.getText())
        )
      )
        return n;
    }
    return node.getSourceFile();
  };

  it("never appears in what a call to our API sends", () => {
    const reaching = new Map<string, string[]>();
    for (const f of files) {
      walk(f.tree, (n) => {
        if (!ts.isCallExpression(n)) return;
        const callee = n.expression.getText();
        const viaClient = /^apiFetch(WithTotal)?$/.test(callee);
        const rawToApi =
          (callee === "fetch" || callee === "expoFetch") &&
          words(n).some((w) => w === "apiUrl");
        if (!viaClient && !rawToApi) return;
        // The path and body are often built a few lines above the call: read
        // the whole function around it.
        const hits = words(enclosingFunction(n)).filter((w) => BBOX.test(w));
        if (hits.length)
          reaching.set(f.rel, [...(reaching.get(f.rel) ?? []), ...hits]);
      });
    }
    const allowed = new Set(names(BBOX_ALLOWED));
    expect(
      [...reaching].filter(([file]) => !allowed.has(file)),
      "A function that calls our API mentions a bounding box (bbox, west, south, east, north). A region-of-interest bbox never reaches our API: offline clips are cut on the phone (offline/regionDownloads.ts, ADR 0036). If this is a route's own bbox, add the file to BBOX_ALLOWED in guestGate.test.ts with why.",
    ).toEqual([]);
  });

  it("is found when it is there — the scan reads a probe", () => {
    const tree = ts.createSourceFile(
      "x.ts",
      "async function f(b: number[]) { const path = `/places?bbox=${b}`; return apiFetch(path); }",
      ts.ScriptTarget.Latest,
      true,
    );
    expect(words(tree).some((w) => BBOX.test(w))).toBe(true);
  });
});
