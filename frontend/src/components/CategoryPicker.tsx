import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import RequiredMark from './ui/RequiredMark';

export interface CatalogCategory {
  id: string;
  slug: string;
  name: string;
}

/** A business lists under one to five catalogue categories (EZ1-I263). */
export const MAX_CATEGORIES = 5;

/** The catalogue's active categories, under the key the services step already uses. */
export function useCatalogCategories() {
  return useQuery<CatalogCategory[]>({
    queryKey: ['catalog-categories'],
    queryFn: async () => (await api.get('/catalog/categories')).data,
    staleTime: 5 * 60_000,
  });
}

/**
 * Category names for slugs, in the order given.
 *
 * Until the catalogue has loaded, or for a slug it no longer lists, the slug is
 * shown as words ("guest-hospitality" as "Guest hospitality") rather than left
 * blank.
 */
export function useCategoryNames() {
  const { data = [] } = useCatalogCategories();
  const bySlug = new Map(data.map((c) => [c.slug, c.name]));
  return (slugs: (string | null | undefined)[] | null | undefined): string[] =>
    (slugs ?? [])
      .filter((s): s is string => Boolean(s))
      .map((s) => bySlug.get(s) ?? s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
}

/** A business's categories as names, joined, for inline use anywhere. */
export function CategoryNames({
  slugs,
  fallback = '',
}: {
  slugs: (string | null | undefined)[] | null | undefined;
  fallback?: string;
}) {
  const names = useCategoryNames();
  return <>{names(slugs).join(', ') || fallback}</>;
}

/**
 * Choosing the categories a business lists under.
 *
 * Every catalogue category as a chip, up to five selected. Once five are
 * chosen the rest are disabled rather than silently ignored, and the count says
 * why. The first category chosen is the one the listing is shown under first.
 */
export default function CategoryPicker({
  value,
  onChange,
  error,
  required = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
  /** Marks the heading; the form's own check is what enforces it. */
  required?: boolean;
}) {
  const { data: categories = [], isPending, isError } = useCatalogCategories();
  const full = value.length >= MAX_CATEGORIES;

  const toggle = (slug: string) => {
    if (value.includes(slug)) onChange(value.filter((s) => s !== slug));
    else if (!full) onChange([...value, slug]);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">
          Categories
          {required && <RequiredMark />}
        </span>
        <span className={`text-xs ${full ? 'text-caution-fg' : 'text-gray-500'}`}>
          {value.length} of {MAX_CATEGORIES} selected
        </span>
      </div>
      <p className="mb-2 text-xs text-gray-500">
        Pick every kind of work this business does, up to {MAX_CATEGORIES}. The first one you pick
        is the one your listing is shown under first.
      </p>

      {isPending ? (
        <p className="text-sm text-gray-500">Loading categories…</p>
      ) : isError ? (
        <p className="alert-critical">The categories could not be loaded. Refresh the page to try again.</p>
      ) : (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
          {categories.map((c) => {
            const on = value.includes(c.slug);
            const disabled = !on && full;
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => toggle(c.slug)}
                className={`rounded-sm border px-3 py-1 text-xs ${
                  on
                    ? 'border-brand bg-brand text-brand-fg'
                    : disabled
                      ? 'cursor-not-allowed border-gray-200 text-gray-400'
                      : 'border-gray-300 text-gray-700 hover:border-brand'
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-critical-fg">{error}</p>}
    </div>
  );
}
