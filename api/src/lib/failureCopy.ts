import { say, type UserSentence } from "@logjam/shared";

// Failure sentences written here once, by the workers, the reaper and the seed.
// A leaf module: the workers pull in env, which the seed must not.
export function topoExportStoppedMessage(): UserSentence {
  return say`This map was stopped because it took too long. Start it again to try again.`;
}
/**
 * topo/worker.py's `UNREADABLE`, word for word (guard:
 * topo/tests/test_worker_helpers.py, `test_the_api_words_an_unreadable_zip_the_same`).
 */
export function topoUnreadableMessage(): UserSentence {
  return say`Logjam couldn't read the LiDAR data. Download the ZIP again, and make it again.`;
}
