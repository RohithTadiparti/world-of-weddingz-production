/**
 * Whether a business's catalog is complete enough to send for verification.
 *
 * Pure, so the rule is stated once and tested without a database: every
 * category the business lists needs at least one service on sale under it, and
 * every service on sale needs at least one live price. The messages name the
 * category (and the service) precisely, because "One of your services needs a
 * live price" left a vendor with five services hunting for which one.
 *
 * A switched-off service is not on sale, so it neither satisfies its category
 * nor needs a price. A service under a category the business no longer lists
 * is off sale for the same reason and is ignored here.
 */

export interface SelectedCategory {
  slug: string;
  /** The catalogue's name for it; null when the catalogue no longer has it. */
  name: string | null;
}

export interface CatalogServiceFacts {
  name: string;
  categorySlug: string | null;
  categoryName: string | null;
  active: boolean;
  /** At least one active offering under it. */
  hasActivePricing: boolean;
}

export function catalogIssues(
  selected: SelectedCategory[],
  services: CatalogServiceFacts[],
): string[] {
  const onSale = services.filter((s) => s.active);
  const issues: string[] = [];
  const unpriced = (label: string, list: CatalogServiceFacts[]) => {
    for (const service of list) {
      if (!service.hasActivePricing) issues.push(`${label}: pricing is missing for ${service.name}`);
    }
  };

  // A business moved over from the single legacy category has not chosen any
  // yet; the catalogue as a whole stands in for its choice.
  if (selected.length === 0) {
    if (onSale.length === 0) return ['Add at least one service'];
    for (const service of onSale) {
      unpriced(service.categoryName ?? service.categorySlug ?? 'Service', [service]);
    }
    return issues;
  }

  for (const category of selected) {
    const label = category.name ?? category.slug;
    const mine = onSale.filter((s) => s.categorySlug === category.slug);
    if (mine.length === 0) {
      issues.push(`${label}: add at least one service`);
      continue;
    }
    unpriced(label, mine);
  }
  return issues;
}
