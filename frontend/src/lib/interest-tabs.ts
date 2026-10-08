/**
 * A tab's count on the Interests board: the server's own where it sends one,
 * else the number of rows it returned for that list. The board has always
 * returned blocked rows without counting them.
 */
export function tabCount(
  board: { counts?: Record<string, number> } & Record<string, unknown>,
  key: string,
): number {
  const counted = board.counts?.[key];
  if (typeof counted === 'number') return counted;
  const rows = board[key];
  return Array.isArray(rows) ? rows.length : 0;
}
