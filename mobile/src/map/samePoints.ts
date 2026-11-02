/** Whether two drawn lines are the same points in the same order. */
export function samePoints(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
): boolean {
  return (
    a.length === b.length &&
    a.every((point, i) => point.every((value, axis) => value === b[i][axis]))
  );
}
