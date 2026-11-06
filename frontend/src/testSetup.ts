// A unit test never reaches the network. An unmocked API call otherwise fails
// with ECONNREFUSED to localhost:8080, and its `.catch(console.error)` can land
// after the worker has torn down: vitest then exits 1 on a green run. Guard:
// `noNetwork.test.ts`. A suite that needs fetch stubs it (`vi.stubGlobal`).
globalThis.fetch = async (input: RequestInfo | URL) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  throw new Error(`unit test reached the network: ${url}`);
};
