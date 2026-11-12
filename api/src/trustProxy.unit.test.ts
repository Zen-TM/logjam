import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { validateEnv } from "./lib/env";

const BASE = {
  NODE_ENV: "development",
  AUTH_MODE: "fake",
  DB_HOST: "localhost",
  DB_NAME: "db",
  DB_USER: "u",
  DB_PASSWORD: "p",
};

function hopsFor(extra: Record<string, string> = {}): number {
  vi.stubEnv("TRUST_PROXY_HOPS", undefined as unknown as string);
  for (const [k, v] of Object.entries({ ...BASE, ...extra })) {
    vi.stubEnv(k, v);
  }
  try {
    return validateEnv().TRUST_PROXY_HOPS;
  } finally {
    vi.unstubAllEnvs();
  }
}

// What Express reports as req.ip for a request that arrives with `xff`.
async function reqIp(hops: number, xff: string): Promise<string> {
  const app = express();
  app.set("trust proxy", hops);
  app.get("/", (req, res) => {
    res.send(req.ip);
  });
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { "x-forwarded-for": xff },
    });
    return await res.text();
  } finally {
    server.close();
  }
}

describe("TRUST_PROXY_HOPS", () => {
  it("defaults to 2, so Elastic Beanstalk is unchanged", () => {
    expect(hopsFor()).toBe(2);
  });

  it("reads the hop count from the environment", () => {
    expect(hopsFor({ TRUST_PROXY_HOPS: "1" })).toBe(1);
  });

  it("rejects a count that is not a whole number", () => {
    expect(() => hopsFor({ TRUST_PROXY_HOPS: "1.5" })).toThrow();
  });

  // Mutation: hard-code `app.set("trust proxy", 2)` in index.ts.
  it("index.ts trusts exactly the configured hop count", () => {
    const source = readFileSync(join(__dirname, "index.ts"), "utf8");
    expect(source).toContain('app.set("trust proxy", env.TRUST_PROXY_HOPS)');
  });

  it("with 1 hop, one forwarded address is the client", async () => {
    expect(await reqIp(1, "198.51.100.7")).toBe("198.51.100.7");
  });

  it("with 1 hop, a spoofed leading address is not trusted", async () => {
    expect(await reqIp(1, "203.0.113.9, 198.51.100.7")).toBe("198.51.100.7");
  });

  it("with 2 hops, the second-from-last address is the client", async () => {
    expect(await reqIp(2, "198.51.100.7, 192.0.2.1")).toBe("198.51.100.7");
  });
});
