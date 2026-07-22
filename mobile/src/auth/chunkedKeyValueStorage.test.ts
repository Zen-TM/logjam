import { describe, it, expect } from "vitest";
import {
  createChunkedKeyValueStorage,
  splitIntoByteChunks,
  toSecureStoreKey,
  type KeyValueBackend,
} from "./chunkedKeyValueStorage";

function makeMemoryBackend(): KeyValueBackend & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async remove(key) {
      store.delete(key);
    },
  };
}

describe("splitIntoByteChunks", () => {
  it("returns a single chunk for a short ASCII string", () => {
    expect(splitIntoByteChunks("hello", 10)).toEqual(["hello"]);
  });

  it("splits ASCII at the byte boundary", () => {
    expect(splitIntoByteChunks("abcdefgh", 4)).toEqual(["abcd", "efgh"]);
  });

  it("returns one empty chunk for the empty string", () => {
    expect(splitIntoByteChunks("", 10)).toEqual([""]);
  });

  it("never splits a multi-byte character", () => {
    // "é" is 2 UTF-8 bytes; with maxBytes 5, "aéé" (5 bytes) fits but the
    // next é would overflow — it must move whole to the next chunk.
    const chunks = splitIntoByteChunks("aéééé", 5);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(5);
    }
    expect(chunks.join("")).toBe("aéééé");
  });

  it("never splits a surrogate pair", () => {
    const emoji = "🙂".repeat(5); // each is 4 UTF-8 bytes, 2 UTF-16 code units
    const chunks = splitIntoByteChunks(emoji, 5);
    expect(chunks.join("")).toBe(emoji);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(5);
    }
  });

  it("throws on an unusably small maxBytes", () => {
    expect(() => splitIntoByteChunks("x", 3)).toThrow(/maxBytes/);
  });
});

describe("toSecureStoreKey", () => {
  it("passes safe keys through unchanged", () => {
    expect(toSecureStoreKey("CognitoIdentityServiceProvider.abc123.idToken")).toBe(
      "CognitoIdentityServiceProvider.abc123.idToken",
    );
  });

  it("encodes unsafe characters (email-shaped usernames)", () => {
    const encoded = toSecureStoreKey("CIP.client.user@example.com.idToken");
    expect(encoded).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(encoded).toContain("_x40_"); // '@'
  });

  it("is injective for keys that collide naively", () => {
    // A literal "_x40_" in one key must not encode to the same output as an
    // "@" in another.
    const a = toSecureStoreKey("k@t");
    const b = toSecureStoreKey("k_x40_t");
    expect(a).not.toBe(b);
  });

  it("distinct realistic keys never collide", () => {
    const keys = [
      "CIP.client.a@b.com.idToken",
      "CIP.client.a@b.com.accessToken",
      "CIP.client.a@b.com.refreshToken",
      "CIP.client.a@b.com.clockDrift",
      "CIP.client.LastAuthUser",
      "CIP.client.a_xb.com.idToken",
    ];
    const encoded = keys.map(toSecureStoreKey);
    expect(new Set(encoded).size).toBe(keys.length);
    for (const key of encoded) expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("createChunkedKeyValueStorage", () => {
  it("round-trips a small value without chunking", async () => {
    const backend = makeMemoryBackend();
    const kv = createChunkedKeyValueStorage(backend, 100);
    await kv.setItem("k", "small");
    expect(await kv.getItem("k")).toBe("small");
    expect(backend.store.get("k")).toBe("small"); // stored directly
  });

  it("round-trips a value larger than the chunk size", async () => {
    const backend = makeMemoryBackend();
    const kv = createChunkedKeyValueStorage(backend, 10);
    const value = "x".repeat(95);
    await kv.setItem("token", value);
    expect(await kv.getItem("token")).toBe(value);
    // Header at base key, chunks alongside
    expect(backend.store.get("token")).toBe("__chunked__:10");
  });

  it("round-trips a realistic JWT-sized value", async () => {
    const backend = makeMemoryBackend();
    const kv = createChunkedKeyValueStorage(backend); // default 1800 bytes
    const jwt = "eyJhbGciOiJSUzI1NiJ9." + "a".repeat(4000) + ".sig";
    await kv.setItem("idToken", jwt);
    expect(await kv.getItem("idToken")).toBe(jwt);
  });

  it("returns null for a missing key", async () => {
    const kv = createChunkedKeyValueStorage(makeMemoryBackend(), 10);
    expect(await kv.getItem("nope")).toBeNull();
  });

  it("cleans up stale chunks when a value shrinks", async () => {
    const backend = makeMemoryBackend();
    const kv = createChunkedKeyValueStorage(backend, 10);
    await kv.setItem("k", "x".repeat(50)); // 5 chunks
    await kv.setItem("k", "short");
    expect(await kv.getItem("k")).toBe("short");
    // No orphaned chunk keys remain
    const chunkKeys = [...backend.store.keys()].filter((k) => k.includes("__chunk_"));
    expect(chunkKeys).toEqual([]);
  });

  it("removeItem deletes value and all chunks", async () => {
    const backend = makeMemoryBackend();
    const kv = createChunkedKeyValueStorage(backend, 10);
    await kv.setItem("k", "x".repeat(50));
    await kv.removeItem("k");
    expect(await kv.getItem("k")).toBeNull();
    const leftover = [...backend.store.keys()].filter((k) => k.startsWith("k"));
    expect(leftover).toEqual([]);
  });

  it("clear removes every stored key including chunked ones", async () => {
    const backend = makeMemoryBackend();
    const kv = createChunkedKeyValueStorage(backend, 10);
    await kv.setItem("a", "small");
    await kv.setItem("b", "y".repeat(40));
    await kv.clear();
    expect(await kv.getItem("a")).toBeNull();
    expect(await kv.getItem("b")).toBeNull();
    expect(backend.store.size).toBe(0);
  });

  it("throws loudly on a missing chunk (torn write) instead of returning a truncated value", async () => {
    const backend = makeMemoryBackend();
    const kv = createChunkedKeyValueStorage(backend, 10);
    await kv.setItem("k", "x".repeat(35)); // 4 chunks
    backend.store.delete("k__chunk_2");
    await expect(kv.getItem("k")).rejects.toThrow(/Missing chunk 2/);
  });

  it("stores a value that collides with the header prefix via chunking", async () => {
    const backend = makeMemoryBackend();
    const kv = createChunkedKeyValueStorage(backend, 100);
    const tricky = "__chunked__:999";
    await kv.setItem("k", tricky);
    expect(await kv.getItem("k")).toBe(tricky);
  });
});
