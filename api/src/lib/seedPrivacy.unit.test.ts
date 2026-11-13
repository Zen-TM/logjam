import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Root AGENTS.md: a committed example (the seed included) is published or made
// up, never a user's. For the people half of that, this reads the seed and the
// data file it loads and holds that every email, phone number and web host in
// them cannot belong to a real person: a reserved example domain or `@local`,
// the ACMA's fictional numbers, or a host named below with its reason. Places
// are the half no test can hold; that stays review.
//
// Mutation that turns it red: put `someone@gmail.com` in the seed, a phone like
// `0412 345 678` in a form answer, or a link to a host not listed below.
const FILES = [
  join(__dirname, "../../prisma/seed.ts"),
  join(__dirname, "../../../shared/src/__fixtures__/place-registry.json"),
];
const text = FILES.map((f) => readFileSync(f, "utf8")).join("\n");

// RFC 2606 reserved names, and `local` (no dot, so never a mailbox on the net).
const RESERVED_HOST =
  /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$|^local$/;

// A host that is not reserved, and why it may stay.
const ALLOWED_HOSTS: Record<string, string> = {
  "ropewiki.com": "the published source of the seeded canyon rows",
  "ozultimate.com": "the published source of the seeded canyon rows",
  "logjamnsw.com": "this project's own domain",
};

// The ACMA's numbers for use in fiction (acma.gov.au, "Telephone numbers for
// use in TV, films, radio and other media"): mobile, spaces removed.
const FICTIONAL_PHONES = new Set([
  "0491570006",
  "0491570110",
  "0491570156",
  "0491570157",
  "0491570158",
  "0491570159",
  "0491570313",
]);

const emailHosts = [...text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)*)/g)].map(
  (m) => m[1].toLowerCase(),
);
const urlHosts = [...text.matchAll(/https?:\/\/([^/\s"'`)\]:?#]+)/g)].map((m) =>
  m[1].toLowerCase(),
);
// An Australian number (ten digits from a 0, spaces allowed) or anything with
// a leading `+`. Not preceded or followed by a word character or dash, so an
// id or a date is not one.
const phones = [
  ...text.matchAll(
    /(?<![\w.-])(0\d(?: ?\d){8}|\+\d(?:[ ()-]?\d){7,})(?![\w-])/g,
  ),
].map((m) => m[1].replace(/[ ()-]/g, ""));

describe("the seed holds nothing that could be a real person's", () => {
  it("finds the emails, hosts and numbers it is meant to scan", () => {
    expect(emailHosts.length).toBeGreaterThanOrEqual(4);
    expect(urlHosts.length).toBeGreaterThanOrEqual(4);
    expect(phones.length).toBeGreaterThanOrEqual(2);
  });

  it("every email is at a reserved domain", () => {
    const bad = emailHosts.filter((h) => !RESERVED_HOST.test(h));
    expect(
      bad,
      "a seeded email is at a real domain: use @local or an example.com address",
    ).toEqual([]);
  });

  it("every phone number is one the ACMA reserves for fiction", () => {
    const bad = phones.filter((p) => !FICTIONAL_PHONES.has(p));
    expect(
      bad,
      "a seeded phone number may be real: use 0491 570 156 or another ACMA fictional number",
    ).toEqual([]);
  });

  it("every host is reserved or named, with its reason", () => {
    const bad = urlHosts.filter(
      (h) => !RESERVED_HOST.test(h) && !(h in ALLOWED_HOSTS),
    );
    expect(
      bad,
      "a seeded link points at a host that is neither reserved nor in ALLOWED_HOSTS: use example.com, or list the host with the reason it is published or ours",
    ).toEqual([]);
  });
});
