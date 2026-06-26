/**
 * Picks a topo name that doesn't collide with the user's existing topo names.
 * Returns `base` when it's free, otherwise the first free `${base} ${n}`
 * (n = 2, 3, …) — e.g. base "Katoomba" with an existing "Katoomba" yields
 * "Katoomba 2".
 */
export function nextTopoName(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
