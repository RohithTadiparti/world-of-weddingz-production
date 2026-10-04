export type NavigationCounts = Record<string, number>;

export function routeBadgeCounts(counts: NavigationCounts): NavigationCounts {
  const out: NavigationCounts = {};
  for (const [route, value] of Object.entries(counts ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[route] = value;
    }
  }
  return out;
}
