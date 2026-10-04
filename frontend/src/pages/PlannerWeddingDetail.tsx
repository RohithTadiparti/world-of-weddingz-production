import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarBlank, MapPin, Play } from '@phosphor-icons/react';
import { EmptyState, Loading } from '../components/ui/Feedback';
import { videoEmbedUrl, videoThumbnail, weddingCover } from '../lib/planner-profile';
import { Card, Lightbox, VideoModal, longDate, usePlanner } from '../components/planner/shared';

/**
 * One wedding from a planner's portfolio: the couple, where and when, the
 * events it ran over, and its photographs and films.
 *
 * Read from the planner's own listing rather than a separate address, so a
 * wedding is only ever shown as part of an approved planner's profile. The
 * way back returns to the profile with the couple's picks still in place.
 */
export default function PlannerWeddingDetail() {
  const { id = '', weddingId = '' } = useParams();
  const { data: planner, isLoading } = usePlanner(id);
  const [photo, setPhoto] = useState<number | null>(null);
  const [video, setVideo] = useState<string | null>(null);

  if (isLoading) return <Loading rows={4} />;
  const wedding = planner?.weddings?.find((w) => w.id === weddingId);
  if (!planner || !wedding) {
    return (
      <EmptyState
        title="Wedding not found"
        action={
          planner ? (
            <Link to={`/wedding-planners/${planner.id}/weddings`} className="btn-outline">
              All weddings
            </Link>
          ) : undefined
        }
      >
        This wedding is no longer in the planner&apos;s portfolio.
      </EmptyState>
    );
  }

  const cover = weddingCover(wedding);
  const events = wedding.events ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
        <Link to={`/wedding-planners/${planner.id}`} className="hover:text-brand">
          ← Back to {planner.agencyName}
        </Link>
        <Link to={`/wedding-planners/${planner.id}/weddings`} className="hover:text-brand">
          All weddings
        </Link>
      </div>

      <section className="overflow-hidden rounded-[--radius-lg] border border-gray-200 bg-surface shadow-card">
        {cover && (
          <div className="aspect-[16/9] bg-surface-sunken sm:aspect-[16/7]">
            <img src={cover} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="px-5 py-6 sm:px-8">
          <p className="eyebrow tracking-[0.22em]">Planned by {planner.agencyName}</p>
          <h1 className="mt-1.5 break-words font-serif text-[2rem] font-normal leading-[1.1] text-brand sm:text-[2.5rem]">
            {wedding.title}
          </h1>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-700">
            {wedding.location && (
              <li className="flex items-center gap-1.5">
                <MapPin size={16} weight="light" aria-hidden />
                {wedding.location}
              </li>
            )}
            {wedding.date && (
              <li className="flex items-center gap-1.5">
                <CalendarBlank size={16} weight="light" aria-hidden />
                {longDate(wedding.date)}
              </li>
            )}
          </ul>
          {wedding.description && (
            <p className="mt-5 whitespace-pre-line text-[0.9375rem] leading-[1.8] text-gray-700">
              {wedding.description}
            </p>
          )}
        </div>
      </section>

      {events.length > 0 && (
        <Card title="Events">
          <ol className="divide-y divide-gray-200 border-y border-gray-200">
            {events.map((ev, i) => (
              <li key={`${ev.name}-${i}`} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
                <div className="sm:w-56 sm:shrink-0">
                  <p className="font-medium text-gray-900">{ev.name}</p>
                  {ev.date && <p className="text-xs text-gray-500">{longDate(ev.date)}</p>}
                </div>
                {ev.description && <p className="min-w-0 text-sm leading-relaxed text-gray-700">{ev.description}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {wedding.photos.length > 0 && (
        <Card title="Photos">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {wedding.photos.map((url, i) => (
              <li key={url}>
                <button
                  type="button"
                  onClick={() => setPhoto(i)}
                  className="group block aspect-square w-full overflow-hidden bg-surface-sunken"
                  aria-label={`Open photo ${i + 1} of ${wedding.photos.length}`}
                >
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {wedding.videos.length > 0 && (
        <Card title="Videos">
          <ul className="grid gap-3 sm:grid-cols-2">
            {wedding.videos.map((url, i) => {
              const still = videoThumbnail(url);
              return (
                <li key={url}>
                  <button
                    type="button"
                    onClick={() => setVideo(url)}
                    className="group relative block aspect-video w-full overflow-hidden bg-gray-900"
                    aria-label={`Play video ${i + 1} of ${wedding.videos.length}`}
                  >
                    {still && <img src={still} alt="" loading="lazy" className="h-full w-full object-cover opacity-85" />}
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-surface/95 text-brand shadow-card transition-transform group-hover:scale-105">
                        <Play size={20} weight="fill" aria-hidden />
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {photo !== null && (
        <Lightbox photos={wedding.photos} start={photo} title={wedding.title} onClose={() => setPhoto(null)} />
      )}
      {video && (
        <VideoModal url={video} embed={videoEmbedUrl(video)} title={wedding.title} onClose={() => setVideo(null)} />
      )}
    </div>
  );
}
