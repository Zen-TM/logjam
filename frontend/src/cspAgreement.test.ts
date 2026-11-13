// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CSP_PROD } from "../vite.config";

function extractCspProdHosts(csp: string): Set<string> {
  const targetDirectives = new Set(["img-src", "media-src", "connect-src"]);
  const hosts = new Set<string>();

  const directives = csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
  for (const directive of directives) {
    const tokens = directive.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...sources] = tokens;
    if (targetDirectives.has(name)) {
      for (const source of sources) {
        if (source.startsWith("https://")) {
          hosts.add(source);
        }
      }
    }
  }

  return hosts;
}

function extractJsonHosts(allowlist: unknown): Set<string> {
  const hosts = new Set<string>();

  function collect(val: unknown) {
    if (typeof val === "string") {
      hosts.add(val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        collect(item);
      }
    } else if (val && typeof val === "object") {
      for (const item of Object.values(val)) {
        collect(item);
      }
    }
  }

  collect(allowlist);
  return hosts;
}

describe("CSP allowlist agreement", () => {
  it("keeps CSP_PROD in vite.config.ts and cspAllowlist in scripts/csp-policy.json in sync", () => {
    const jsonPath = fileURLToPath(
      new URL("../../scripts/csp-policy.json", import.meta.url),
    );
    const rawJson = fs.readFileSync(jsonPath, "utf-8");
    const parsed = JSON.parse(rawJson);

    const viteHosts = extractCspProdHosts(CSP_PROD);
    const jsonHosts = extractJsonHosts(parsed.cspAllowlist);

    const onlyInVite = [...viteHosts].filter((h) => !jsonHosts.has(h)).sort();
    const onlyInJson = [...jsonHosts].filter((h) => !viteHosts.has(h)).sort();

    if (onlyInVite.length > 0 || onlyInJson.length > 0) {
      const failureParts: string[] = [];
      if (onlyInVite.length > 0) {
        failureParts.push(
          `Only in vite.config.ts (CSP_PROD):\n  ${onlyInVite.join("\n  ")}`,
        );
      }
      if (onlyInJson.length > 0) {
        failureParts.push(
          `Only in scripts/csp-policy.json (cspAllowlist):\n  ${onlyInJson.join("\n  ")}`,
        );
      }
      expect.fail(`CSP allowlists disagree:\n\n${failureParts.join("\n\n")}`);
    }

    expect(viteHosts).toEqual(jsonHosts);
  });
});

// maplibre-gl 6 loads its worker from a same-origin file
// (assets/maplibre-<hash>/), so nothing needs blob: workers. A blob: worker
// source would let any script that can build a Blob run code off the main
// thread outside script-src. Mutation that turns it red: add blob: (or any
// host) to worker-src in CSP_PROD.
describe("CSP worker-src", () => {
  it("allows workers only from Logjam Web's own origin", () => {
    const workerSrc = CSP_PROD.split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("worker-src "));
    expect(workerSrc).toBe("worker-src 'self'");
  });
});

// The origins the code names against CSP_PROD. A host the code fetches from
// but CSP_PROD lacks is blocked in a production build and nowhere else: the
// dev server sets no CSP. So every https host in non-test source in this
// package or shared/ is covered by an img-src, media-src or connect-src
// source, or is named below as a link, a credit, an example or a cache key that no request
// goes to. NOT_FETCHED is a claim made by hand: a host that starts being fetched
// goes in CSP_PROD (and scripts/csp-policy.json), not here.
//
// Mutation that turns it red: add `fetch("https://telemetry.example.org/x")`
// to any source file here or in shared/src; remove a host from CSP_PROD's
// connect-src and img-src (tile.openstreetmap.org, say); or add to NOT_FETCHED a
// host the code does not name.
const NOT_FETCHED: Record<string, string> = {
  "geopdf-tiles.invalid":
    "the Cache API key GeoPDF tiles are stored under, never requested",
  "creativecommons.org": "licence link in a credit",
  "www.openstreetmap.org": "credit link",
  "github.com": "credit link, and the repository link on the account page",
  "www.spatial.nsw.gov.au": "terms link and credit",
  "spatial.nsw.gov.au": "credit link",
  "data.nsw.gov.au": "credit link",
  "www.abs.gov.au": "credit link",
  "data.gov.au": "credit link",
  "datasets.seed.nsw.gov.au": "credit link",
  "registry.opendata.aws": "credit link",
  "protomaps.com": "credit link",
  "open-meteo.com": "credit link; the forecast itself is api.open-meteo.com",
  "ozultimate.com": "a link out to a track note page",
  "logjamnsw.com": "Logjam's own address in a User-Agent the API sends",
  "example.test": "an example host in a doc comment or fixture",
  "example.com": "an example host in a doc comment or fixture",
};

function sourceFiles(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter(
      (f) =>
        /\.tsx?$/.test(f) &&
        !/\.test\.tsx?$|\.d\.ts$|(^|\/)(__tests__|__fixtures__|node_modules|dist)\//.test(
          f,
        ),
    )
    .map((f) => path.join(dir, f));
}

function sourceHosts(): Map<string, string> {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const hosts = new Map<string, string>();
  for (const dir of ["frontend/src", "shared/src"])
    for (const file of sourceFiles(path.join(root, dir)))
      for (const m of fs
        .readFileSync(file, "utf8")
        .matchAll(/https:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g))
        hosts.set(m[1], path.relative(root, file));
  return hosts;
}

function coveredByCsp(host: string, csp: Set<string>): boolean {
  return [...csp].some((source) => {
    const pattern = source.replace("https://", "");
    return pattern.startsWith("*.")
      ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1
      : host === pattern;
  });
}

describe("CSP_PROD against the origins the code names", () => {
  const hosts = sourceHosts();
  const csp = extractCspProdHosts(CSP_PROD);

  it("finds the hosts the source names", () => {
    // A scan that stops matching must not pass: 30 or so at the time of writing.
    expect(hosts.size).toBeGreaterThanOrEqual(25);
  });

  it("covers every host the source names, or names it as never fetched", () => {
    const unknown = [...hosts]
      .filter(([h]) => !coveredByCsp(h, csp) && !(h in NOT_FETCHED))
      .map(([h, file]) => `${h} (${file})`)
      .sort();
    expect(
      unknown,
      `Hosts the code names that CSP_PROD does not allow: ${unknown.join(", ")}. If the code fetches it or loads an image or media from it, add it to CSP_PROD in vite.config.ts (img-src or connect-src or media-src) and cspAllowlist in scripts/csp-policy.json; if it is only a link, a credit or a key, add it to NOT_FETCHED in this test with the reason.`,
    ).toEqual([]);
  });

  it("keeps NOT_FETCHED to hosts the code names and CSP_PROD does not allow", () => {
    const stale = Object.keys(NOT_FETCHED).filter(
      (h) => !hosts.has(h) || coveredByCsp(h, csp),
    );
    expect(
      stale,
      `NOT_FETCHED lists hosts the source no longer names, or CSP_PROD now allows: ${stale.join(", ")}. Remove them.`,
    ).toEqual([]);
  });
});
