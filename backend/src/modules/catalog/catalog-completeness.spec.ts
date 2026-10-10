import { CatalogServiceFacts, catalogIssues } from './catalog-completeness';

const bridal = { slug: 'bridal-wear', name: 'Bridal Wear' };
const groom = { slug: 'groom-wear', name: 'Groom Wear' };

function svc(partial: Partial<CatalogServiceFacts>): CatalogServiceFacts {
  return {
    name: 'Lehenga',
    categorySlug: bridal.slug,
    categoryName: bridal.name,
    active: true,
    hasActivePricing: true,
    ...partial,
  };
}

describe('catalogIssues', () => {
  it('is empty when every selected category has a priced service', () => {
    expect(
      catalogIssues(
        [bridal, groom],
        [svc({}), svc({ name: 'Sherwani', categorySlug: groom.slug, categoryName: groom.name })],
      ),
    ).toEqual([]);
  });

  it('names a selected category that has no service at all', () => {
    expect(catalogIssues([bridal, groom], [svc({})])).toEqual([
      'Groom Wear: add at least one service',
    ]);
  });

  it('names every service in a category that has no active pricing', () => {
    expect(
      catalogIssues(
        [bridal],
        [svc({ hasActivePricing: false }), svc({ name: 'Saree draping', hasActivePricing: false })],
      ),
    ).toEqual([
      'Bridal Wear: pricing is missing for Lehenga',
      'Bridal Wear: pricing is missing for Saree draping',
    ]);
  });

  it('flags an unpriced service even when another service in the category is priced', () => {
    expect(
      catalogIssues([bridal], [svc({}), svc({ name: 'Saree draping', hasActivePricing: false })]),
    ).toEqual(['Bridal Wear: pricing is missing for Saree draping']);
  });

  it('reports categories in the order the business chose them', () => {
    expect(catalogIssues([groom, bridal], [])).toEqual([
      'Groom Wear: add at least one service',
      'Bridal Wear: add at least one service',
    ]);
  });

  it('does not count a switched-off service towards its category', () => {
    expect(catalogIssues([bridal], [svc({ active: false })])).toEqual([
      'Bridal Wear: add at least one service',
    ]);
  });

  it('ignores services outside the selected categories', () => {
    expect(
      catalogIssues(
        [bridal],
        [svc({}), svc({ name: 'Cake', categorySlug: 'catering', hasActivePricing: false })],
      ),
    ).toEqual([]);
  });

  it('falls back to the whole catalogue for a business with no categories yet', () => {
    expect(catalogIssues([], [])).toEqual(['Add at least one service']);
    expect(catalogIssues([], [svc({ hasActivePricing: false })])).toEqual([
      'Bridal Wear: pricing is missing for Lehenga',
    ]);
    expect(catalogIssues([], [svc({})])).toEqual([]);
  });

  it('uses the slug when the catalogue no longer knows a category name', () => {
    expect(catalogIssues([{ slug: 'retired-trade', name: null }], [])).toEqual([
      'retired-trade: add at least one service',
    ]);
  });
});
