import { WEATHER_MAP } from "@logjam/shared";

/**
 * Whether the overlay should ask the CDN for the manifest now. It is asked
 * when Weather is switched on, when the app returns to the front, and when
 * signal comes back, and answers the same each time: never while off or
 * offline, and only if none was fetched yet or the one held is over
 * `WEATHER_MAP.refreshAfterMs` old. There is no timer asking: a run held
 * longer than that is replaced at the next of those three, not on a clock.
 * `fetchedAt` is null until the first answer, and 0 after a Retry.
 * Guard: weatherMapRefetch.test.ts.
 */
export function weatherFetchDue(input: {
  enabled: boolean;
  online: boolean;
  fetchedAt: number | null;
  now: number;
}): boolean {
  if (!input.enabled || !input.online) return false;
  return (
    input.fetchedAt === null ||
    input.now - input.fetchedAt >= WEATHER_MAP.refreshAfterMs
  );
}
