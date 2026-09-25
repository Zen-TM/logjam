// Chunked key-value storage adapter (pure — the expo-secure-store binding
// lives in secureKeyValueStorage.ts so this logic is vitest-testable).
//
// Why: Amplify persists Cognito tokens through a KeyValueStorageInterface, and
// our store is expo-secure-store (Keychain/Keystore — mobile/CLAUDE.md rule:
// never AsyncStorage). Android's Keystore-backed SecureStore warns above
// 2048 bytes per value, and Cognito JWTs regularly exceed that. So values are
// split into byte-bounded chunks, each stored under a derived key, with a
// small header at the base key describing the chunk count.

export interface KeyValueBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// Matches Amplify's KeyValueStorageInterface shape (structural typing — no
// aws-amplify import here to keep this module pure).
export interface KeyValueStorage {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

// SecureStore's documented Android ceiling is 2048 bytes per value; leave
// headroom for the chunk-header prefix and key-derivation overhead.
export const MAX_CHUNK_BYTES = 1800;

const CHUNK_HEADER_PREFIX = "__chunked__:";
// Persisted index of every base key we have written, so clear() can enumerate
// (SecureStore has no listing API).
const INDEX_KEY = "__logjam_kv_index__";

const encoder = new TextEncoder();

/**
 * Split a string into chunks whose UTF-8 byte length each stays ≤ maxBytes,
 * never splitting inside a surrogate pair. Greedy: grows each chunk until the
 * next code point would overflow.
 */
export function splitIntoByteChunks(value: string, maxBytes: number): string[] {
  if (maxBytes < 4) {
    // A single code point can be 4 UTF-8 bytes; anything smaller can wedge.
    throw new Error(`maxBytes must be >= 4, got ${maxBytes}`);
  }
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  let i = 0;
  while (i < value.length) {
    const codePoint = value.codePointAt(i)!;
    const char = String.fromCodePoint(codePoint);
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > maxBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
    i += char.length; // 2 for astral code points, 1 otherwise
  }
  if (current.length > 0 || chunks.length === 0) chunks.push(current);
  return chunks;
}

// SecureStore keys must match [A-Za-z0-9._-]. Amplify keys contain other
// characters (an email-shaped username carries '@'); encode anything outside
// the safe set as _xHH_ (hex of the char code), and escape a literal "_x"
// sequence so the mapping stays injective — two distinct Amplify keys must
// never collide in the store. (Lives here, not in the SecureStore binding,
// so it stays pure and vitest-testable.)
export function toSecureStoreKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]|_x/g, (match) =>
    match === "_x"
      ? "_x5f_x" // escape a literal "_x" sequence
      : `_x${match.charCodeAt(0).toString(16)}_`,
  );
}

function chunkKey(baseKey: string, index: number): string {
  return `${baseKey}__chunk_${index}`;
}

async function readIndex(backend: KeyValueBackend): Promise<string[]> {
  const raw = await backend.get(INDEX_KEY);
  if (raw == null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((k) => typeof k !== "string")) {
    // Fail loudly — a corrupt index means the store is in an unknown state.
    throw new Error("Corrupt key-value storage index");
  }
  return parsed as string[];
}

async function writeIndex(backend: KeyValueBackend, keys: string[]): Promise<void> {
  await backend.set(INDEX_KEY, JSON.stringify(keys));
}

/**
 * Delete `count` chunks AND any beyond them, up to the first gap.
 *
 * The header is written last, so a process death mid-`setItem` leaves a
 * contiguous run of chunks that no header counts — token fragments that
 * nothing could reach again, because SecureStore has no listing API. Chunks
 * are written in order, so "sweep from 0 to the first gap" is exactly the run
 * this module could have written; `count` is a lower bound, not the truth.
 */
async function removeChunks(
  backend: KeyValueBackend,
  baseKey: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await backend.remove(chunkKey(baseKey, i));
  }
  for (let i = count; (await backend.get(chunkKey(baseKey, i))) != null; i++) {
    await backend.remove(chunkKey(baseKey, i));
  }
}

async function removeKey(backend: KeyValueBackend, key: string): Promise<void> {
  const existing = await backend.get(key);
  let count = 0;
  if (existing != null && existing.startsWith(CHUNK_HEADER_PREFIX)) {
    count = Number(existing.slice(CHUNK_HEADER_PREFIX.length));
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Corrupt chunk header for key ${key}`);
    }
  }
  // Unconditional: a headerless base key can still have orphan chunks beside
  // it, and they are the whole point of the sweep.
  await removeChunks(backend, key, count);
  await backend.remove(key);
}

export function createChunkedKeyValueStorage(
  backend: KeyValueBackend,
  maxChunkBytes: number = MAX_CHUNK_BYTES,
): KeyValueStorage {
  return {
    async setItem(key: string, value: string): Promise<void> {
      // The index entry goes in BEFORE the value, not after. It is what
      // `clear()` enumerates, so a process death partway through the writes
      // below would otherwise leave Cognito token fragments under a base key
      // that sign-out and account-switch can never see again. An index entry
      // for a value that never landed is harmless: `removeKey` on an absent
      // key is a no-op.
      const index = await readIndex(backend);
      if (!index.includes(key)) {
        await writeIndex(backend, [...index, key]);
      }

      // Remove any previous value first so a shrinking chunk count can't
      // leave stale trailing chunks behind.
      await removeKey(backend, key);

      const valueBytes = encoder.encode(value).length;
      if (valueBytes <= maxChunkBytes && !value.startsWith(CHUNK_HEADER_PREFIX)) {
        await backend.set(key, value);
      } else {
        const chunks = splitIntoByteChunks(value, maxChunkBytes);
        for (let i = 0; i < chunks.length; i++) {
          await backend.set(chunkKey(key, i), chunks[i]);
        }
        await backend.set(key, `${CHUNK_HEADER_PREFIX}${chunks.length}`);
      }
    },

    async getItem(key: string): Promise<string | null> {
      const stored = await backend.get(key);
      if (stored == null) return null;
      if (!stored.startsWith(CHUNK_HEADER_PREFIX)) return stored;
      const count = Number(stored.slice(CHUNK_HEADER_PREFIX.length));
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`Corrupt chunk header for key ${key}`);
      }
      const chunks: string[] = [];
      for (let i = 0; i < count; i++) {
        const chunk = await backend.get(chunkKey(key, i));
        if (chunk == null) {
          // Fail loudly: a missing chunk means a torn write — surfacing a
          // truncated token would produce baffling auth failures downstream.
          throw new Error(`Missing chunk ${i} for key ${key}`);
        }
        chunks.push(chunk);
      }
      return chunks.join("");
    },

    async removeItem(key: string): Promise<void> {
      await removeKey(backend, key);
      const index = await readIndex(backend);
      if (index.includes(key)) {
        await writeIndex(backend, index.filter((k) => k !== key));
      }
    },

    async clear(): Promise<void> {
      const index = await readIndex(backend);
      for (const key of index) {
        await removeKey(backend, key);
      }
      await backend.remove(INDEX_KEY);
    },
  };
}
