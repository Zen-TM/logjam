import { say } from "@logjam/shared";

// Failure sentences written here once, by the workers, the reaper and the seed.
// A leaf module: the workers pull in env, which the seed must not.
export const TOPO_EXPORT_STOPPED_MESSAGE = say`This map was stopped because it took too long. Start it again to try again.`;
/** topo/worker.py's `UNREADABLE`, word for word (its test holds them equal). */
export const TOPO_UNREADABLE_MESSAGE = say`Logjam couldn't read the LiDAR data. Download the ZIP again, and make it again.`;
