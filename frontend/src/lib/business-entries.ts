export type BusinessEntry = Record<string, unknown>;

export function readBusinessEntries(business: BusinessEntry = {}): BusinessEntry[] {
  if (Array.isArray(business.entries)) return business.entries;
  return Object.keys(business).length ? [business] : [];
}
