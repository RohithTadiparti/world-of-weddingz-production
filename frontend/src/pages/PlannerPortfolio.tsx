import { Link, useParams } from 'react-router-dom';
import { MapPin } from '@phosphor-icons/react';
import { EmptyState, Loading } from '../components/ui/Feedback';
import { weddingCover } from '../lib/planner-profile';
import { usePlanner, weddingMeta } from '../components/planner/shared';

/**
 * Every wedding a planner has written up, as a grid, reached from "View All
 * Weddings" on their profile. The profile's carousel shows them one row at a
 * time; this is the whole portfolio at once. The couple's picks on the
 * profile are kept in the session, so going back loses nothing.
 */
export default function PlannerPortfolio() {
  const { id = '' } = useParams();
  const { data: planner, isLoading } = usePlanner(id);

  if (isLoading) return <Loading rows={4} />;
  if (!planner) {
    return (
      <EmptyState title="Planner not found">
        This planner is not available. They may have been removed or are not yet approved.
      </EmptyState>
    );
  }

  const weddings = planner.weddings ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to={`/wedding-planners/${planner.id}`} className="inline-block text-sm text-gray-600 hover:text-brand">
        ← Back to {planner.agencyName}
      </Link>
      <header>
        <p className="eyebrow tracking-[0.22em]">Portfolio</p>
        <h1 className="mt-1.5 font-serif text-[2rem] font-normal leading-[1.1] text-brand sm:text-[2.5rem]">
          Weddings by {planner.agencyName}
        </h1>
      </header>

      {weddings.length === 0 ? (
        <EmptyState title="No weddings yet">This planner has not added any weddings to their portfolio.</EmptyState>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {weddings.map((w) => {
            const cover = weddingCover(w);
            const meta = weddingMeta(w);
            return (
              <li key={w.id}>
                <Link
                  to={`/wedding-planners/${planner.id}/weddings/${w.id}`}
                  className="group block h-full border border-gray-200 bg-surface shadow-card transition-colors hover:border-brand"
                >
                  <div className="aspect-[4/3] overflow-hidden bg-surface-sunken">
                    {cover && (
                      <img
                        src={cover}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    )}
                  </div>
                  <div className="p-4">
                    <h2 className="font-serif text-xl leading-tight text-gray-900 group-hover:text-brand">{w.title}</h2>
                    {meta && (
                      <p className="mt-1.5 flex items-start gap-1 text-sm text-gray-600">
                        <MapPin size={14} weight="light" className="mt-0.5 shrink-0" aria-hidden />
                        <span className="min-w-0">{meta}</span>
                      </p>
                    )}
                    <p className="mt-2 text-xs text-gray-500">
                      {w.photos.length} photo{w.photos.length === 1 ? '' : 's'}
                      {w.videos.length ? `, ${w.videos.length} video${w.videos.length === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
