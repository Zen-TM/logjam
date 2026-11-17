// Synchronous key/value store for the handful of device preferences that must
// be known BEFORE the first `StyleSheet.create` is evaluated — currently just
// the theme scheme.
//
// Its own tiny database, deliberately: `logjam.db` (mirror + outbox) and
// `logjam-offline.db` (map artifacts) are both opened asynchronously, and this
// has to answer during module evaluation, before any `await` exists. A second
// connection to either of those from module-eval time would be a needless race
// for the sake of one string.
//
// Read failure is not an error: every caller has a correct default (the
// Sandstone scheme), so a missing store just means "no choice recorded".
// WRITE failure is an error, and `lastWriteError` is how the surface that asked
// for the write tells the user their preference didn't stick.
//
// PRIVACY: device preferences only — no place names, no coordinates, no
// account identifiers. App-private storage like every other database here.
import type * as SQLiteModule from "expo-sqlite";

const DB_NAME = "logjam-prefs.db";

type Db = SQLiteModule.SQLiteDatabase;

// `undefined` = not tried yet, `null` = unavailable (see openDatabase).
let database: Db | null | undefined;
/** Why a write failed; `prefWriteErrorSentence.ts` has the sentence. */
export type PrefWriteError = "unavailable" | "not_stored";
let lastWriteError: PrefWriteError | null = null;

function openDatabase(): Db | null {
  if (database !== undefined) return database;
  database = null;
  try {
    // Required lazily rather than imported: this module is reached (through
    // theme.ts) by pure unit tests running in plain node, where loading a
    // native module throws. There, falling back to the defaults is the
    // correct behaviour, not a failure worth logging on every test file.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SQLite = require("expo-sqlite") as typeof SQLiteModule;
    const opened = SQLite.openDatabaseSync(DB_NAME);
    opened.execSync(
      "CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    database = opened;
  } catch {
    database = null;
  }
  return database;
}

/** The recorded value, or null when nothing is recorded (or the store is unavailable). */
export function readPref(key: string): string | null {
  const db = openDatabase();
  if (!db) return null;
  try {
    const row = db.getFirstSync<{ value: string }>(
      "SELECT value FROM prefs WHERE key = ?",
      key,
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a value. Returns false when it could not be stored, so the caller can
 * say so — silently dropping a preference the user just set is the one failure
 * mode this file must not have (prefsDb.test.ts).
 */
export function writePref(key: string, value: string): boolean {
  const db = openDatabase();
  if (!db) {
    lastWriteError = "unavailable";
    return false;
  }
  try {
    db.runSync(
      "INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
    lastWriteError = null;
    return true;
  } catch (err) {
    console.error(err);
    lastWriteError = "not_stored";
    return false;
  }
}

/**
 * Why the last write failed, as a code the surface that requested it turns
 * into a sentence (`prefWriteErrorSentence`). A code because this file cannot
 * import `t`: it loads before the language is known (language.ts).
 */
export function lastPrefWriteError(): PrefWriteError | null {
  return lastWriteError;
}
