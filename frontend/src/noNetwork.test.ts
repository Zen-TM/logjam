import { expect, it } from "vitest";
import { assertNoNetwork, reachedNetwork } from "./testSetup";

// Mutation: drop `setupFiles` from vitest.config.ts, or the stub in
// testSetup.ts, and the real fetch fails with "fetch failed" instead; make
// assertNoNetwork return without throwing, and a request the code under test
// caught passes its test again.
it("rejects a request nobody mocked, naming its URL, however it is asked", async () => {
  const url = "http://localhost:8080/places/p1/shares";
  for (const input of [url, new URL(url), new Request(url)])
    await expect(fetch(input)).rejects.toThrow(
      `unit test reached the network: ${url}`,
    );
  // The afterEach would fail this test for the three calls; it expects them.
  expect(reachedNetwork).toEqual([url, url, url]);
  expect(assertNoNetwork).toThrow(`unit test reached the network: ${url}`);
  expect(reachedNetwork).toEqual([]);
});

// Mutation: have assertNoNetwork throw whatever was asked, and every test fails.
it("lets a test that asked nothing pass", () => {
  expect(assertNoNetwork).not.toThrow();
});
