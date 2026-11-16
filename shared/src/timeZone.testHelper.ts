/** Runs `run` with the process in `timeZone`, then puts the zone back, or unsets it if it was unset. For tests only: the build leaves it out (tsconfig.json). */
export function inTimeZone<T>(timeZone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}
