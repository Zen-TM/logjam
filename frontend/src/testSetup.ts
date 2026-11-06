import { afterEach } from "vitest";

// A unit test never reaches the network. An unmocked API call otherwise fails
// with ECONNREFUSED to localhost:8080, and its `.catch(console.error)` can land
// after the worker has torn down: vitest then exits 1 on a green run. The stub
// rejects, and since code under test often catches that, each test also fails
// afterwards if it reached the network at all. Guard: `noNetwork.test.ts`. A
// suite that needs fetch stubs it (`vi.stubGlobal`).
export const reachedNetwork: string[] = [];

globalThis.fetch = async (input: RequestInfo | URL) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  reachedNetwork.push(url);
  throw new TypeError(`unit test reached the network: ${url}`);
};

/** Throws for any request since the last call, and forgets them. */
export function assertNoNetwork(): void {
  const urls = reachedNetwork.splice(0);
  if (urls.length > 0)
    throw new Error(`unit test reached the network: ${urls.join(", ")}`);
}

afterEach(assertNoNetwork);
