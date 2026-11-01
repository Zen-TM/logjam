import { say } from "@logjam/shared";

// Failure sentences written here once, by the workers, the reaper and the seed.
// A leaf module: the workers pull in env, which the seed must not.
export const TOPO_EXPORT_STOPPED_MESSAGE = say`This export was stopped because it took too long. Start it again to try again.`;
/** topo/worker.py's sentence for an unreadable ZIP, which is Python's to write. */
export const TOPO_UNREADABLE_MESSAGE = say`Logjam couldn't read the LiDAR data. Check the ZIP is the one ELVIS sent you.`;
