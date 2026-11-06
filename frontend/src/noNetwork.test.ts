import { expect, it } from "vitest";

// Mutation: drop `setupFiles` from vitest.config.ts, or the stub in
// testSetup.ts, and the real fetch fails with "fetch failed" instead.
it("fails a request nobody mocked, naming its URL", async () => {
  await expect(fetch("http://localhost:8080/places/p1/shares")).rejects.toThrow(
    "unit test reached the network: http://localhost:8080/places/p1/shares",
  );
});
