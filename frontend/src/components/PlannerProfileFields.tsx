import { useState } from 'react';
import PhotoUploader from './PhotoUploader';
import {
  MAX_PLANNER_WEDDINGS,
  MAX_WEDDING_EVENTS,
  MAX_WEDDING_PHOTOS,
  MAX_WEDDING_VIDEOS,
  PLANNER_SERVICES,
  PLANNER_SPECIALIZATIONS,
  PlannerWedding,
} from '../lib/planner-profile';

/**
 * The parts of a planner's public profile that are more than a text box: the
 * services they offer, the kinds of wedding they specialise in, and the
 * weddings they have run.
 *
 * Kept out of ProviderConsole because the weddings editor alone is a small
 * form of its own, and the listing form was already the longest thing on the
 * page. The listing form owns the state; these only render it and report
 * changes, so a save still sends one body from one place.
 */

/** An https link, which is all the server stores for a video. */
export const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i;

/** The services a planner offers, as a grid of checkboxes. */
export function PlannerServicesPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="border-t pt-3">
      <legend className="label">Services you offer</legend>
      <p className="mb-2 text-sm text-gray-600">
        Couples pick from these when they send a request, so tick everything you take on.
      </p>
      <div className="grid gap-x-4 gap-y-2 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-3">
        {PLANNER_SERVICES.map((s) => (
          <label key={s.key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={value.includes(s.key)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, s.key] : value.filter((k) => k !== s.key))
              }
            />
            {s.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The kinds of wedding a planner specialises in, as toggle chips. */
export function PlannerSpecializationsPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="border-t pt-3">
      <label className="label">Wedding specialisations</label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Wedding specialisations">
        {PLANNER_SPECIALIZATIONS.map((s) => {
          const on = value.includes(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((k) => k !== s.key) : [...value, s.key])}
              className={`rounded-sm border px-3 py-1 text-xs ${
                on
                  ? 'border-brand bg-brand text-brand-fg'
                  : 'border-gray-300 text-gray-700 hover:border-brand'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface WeddingEventDraft {
  name: string;
  date: string;
  description: string;
}

/**
 * A wedding as the form holds it.
 *
 * `id` is the server's, present only on weddings that were already saved, and
 * goes back on the save so the server keeps the same wedding (and its address)
 * rather than replacing it with a new one. `key` is the form's own, so React
 * can track a wedding that has no id yet.
 */
export interface WeddingDraft {
  id?: string;
  key: string;
  title: string;
  location: string;
  date: string;
  description: string;
  coverUrl: string;
  photos: string[];
  videos: string[];
  events: WeddingEventDraft[];
}

let draftCounter = 0;
const nextKey = () => `draft-${++draftCounter}`;

/** A date input only reads `YYYY-MM-DD`; the server may answer with a full timestamp. */
const dayOf = (d?: string | null) => (d ? d.slice(0, 10) : '');

export function toWeddingDrafts(weddings?: PlannerWedding[] | null): WeddingDraft[] {
  return (weddings ?? []).map((w) => ({
    id: w.id,
    key: w.id || nextKey(),
    title: w.title ?? '',
    location: w.location ?? '',
    date: dayOf(w.date),
    description: w.description ?? '',
    coverUrl: w.coverUrl ?? '',
    photos: w.photos ?? [],
    videos: w.videos ?? [],
    events: (w.events ?? []).map((e) => ({
      name: e.name ?? '',
      date: dayOf(e.date),
      description: e.description ?? '',
    })),
  }));
}

const blankWedding = (): WeddingDraft => ({
  key: nextKey(),
  title: '',
  location: '',
  date: '',
  description: '',
  coverUrl: '',
  photos: [],
  videos: [],
  events: [],
});

/**
 * The weddings as the PUT expects them. Blanks go as null so clearing a field
 * on a saved wedding clears it on the server too; events without a name are
 * dropped, since a name is the one thing an event must have.
 */
export function weddingsPayload(drafts: WeddingDraft[]) {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  return drafts.map((w) => ({
    ...(w.id ? { id: w.id } : {}),
    title: w.title.trim(),
    location: orNull(w.location),
    date: orNull(w.date),
    description: orNull(w.description),
    coverUrl: orNull(w.coverUrl),
    photos: w.photos,
    videos: w.videos.map((v) => v.trim()).filter(Boolean),
    events: w.events
      .filter((e) => e.name.trim())
      .map((e) => ({ name: e.name.trim(), date: orNull(e.date), description: orNull(e.description) })),
  }));
}

/** What is wrong with the weddings, or null when they can be saved. */
export function weddingsError(drafts: WeddingDraft[]): string | null {
  for (const [i, w] of drafts.entries()) {
    const which = w.title.trim() || `Wedding ${i + 1}`;
    const len = w.title.trim().length;
    if (len < 2 || len > 120) return `${which}: give the couple's names (2 to 120 characters).`;
    if (w.videos.some((v) => v.trim() && !HTTPS_URL.test(v.trim()))) {
      return `${which}: video links must start with https://.`;
    }
  }
  return null;
}

/** Moves the item at `i` by `by` places, if there is room. */
function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** The "Previous weddings" editor: a list of weddings, each a small form. */
export function PlannerWeddingsEditor({
  value,
  onChange,
  error,
}: {
  value: WeddingDraft[];
  onChange: (next: WeddingDraft[]) => void;
  error?: string;
}) {
  const update = (i: number, patch: Partial<WeddingDraft>) =>
    onChange(value.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  return (
    <div className="border-t pt-3">
      <label className="label">Previous weddings</label>
      <p className="mb-2 text-sm text-gray-600">
        Each wedding gets its own page on your profile, with its photos, videos and events. The
        first one here shows first.
      </p>
      {value.length > 0 && (
        <ol className="mb-2 space-y-3">
          {value.map((w, i) => (
            <li key={w.key}>
              <WeddingCard
                wedding={w}
                index={i}
                count={value.length}
                onChange={(patch) => update(i, patch)}
                onMove={(by) => onChange(move(value, i, by))}
                onRemove={() => onChange(value.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className="btn-outline"
        disabled={value.length >= MAX_PLANNER_WEDDINGS}
        onClick={() => onChange([...value, blankWedding()])}
      >
        Add a wedding
      </button>
      {value.length >= MAX_PLANNER_WEDDINGS && (
        <p className="mt-1 text-xs text-gray-500">
          A profile holds up to {MAX_PLANNER_WEDDINGS} weddings.
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function WeddingCard({
  wedding: w,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  wedding: WeddingDraft;
  index: number;
  count: number;
  onChange: (patch: Partial<WeddingDraft>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const [videoDraft, setVideoDraft] = useState('');
  const videoOk = HTTPS_URL.test(videoDraft.trim());

  return (
    <div className="space-y-3 rounded-sm border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-800">
          {w.title.trim() || `Wedding ${index + 1}`}
        </p>
        <div className="flex gap-2 text-xs">
          <button type="button" className="btn-outline" disabled={index === 0} onClick={() => onMove(-1)}>
            Up
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            Down
          </button>
          <button type="button" className="btn-outline text-critical-fg" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Couple</label>
          <input
            className="input"
            placeholder="Rahul & Priya"
            maxLength={120}
            value={w.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Location</label>
          <input
            className="input"
            maxLength={120}
            value={w.location}
            onChange={(e) => onChange({ location: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Date</label>
          <input
            className="input"
            type="date"
            value={w.date}
            onChange={(e) => onChange({ date: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className="label">About this wedding</label>
        <textarea
          className="input"
          rows={2}
          maxLength={2000}
          value={w.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      {/* Photos, uploaded the same way as the portfolio. The cover is one of
          them, picked here, so there is no separate upload to forget. */}
      <div>
        <label className="label">Photos</label>
        {w.photos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {w.photos.map((url) => {
              const isCover = (w.coverUrl || w.photos[0]) === url;
              return (
                <div key={url} className="relative">
                  <img
                    src={url}
                    alt=""
                    className={`h-20 w-28 rounded-sm object-cover ${isCover ? 'ring-2 ring-brand' : ''}`}
                    loading="lazy"
                  />
                  <div className="absolute inset-x-1 top-1 flex justify-between">
                    <button
                      type="button"
                      className="rounded-sm bg-surface/90 px-1.5 text-xs text-gray-700"
                      disabled={isCover}
                      onClick={() => onChange({ coverUrl: url })}
                    >
                      {isCover ? 'Cover' : 'Make cover'}
                    </button>
                    <button
                      type="button"
                      className="rounded-sm bg-surface/90 px-1.5 text-xs text-gray-700"
                      onClick={() =>
                        onChange({
                          photos: w.photos.filter((u) => u !== url),
                          ...(w.coverUrl === url ? { coverUrl: '' } : {}),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {w.photos.length < MAX_WEDDING_PHOTOS ? (
          <PhotoUploader
            kind="photo"
            label="Upload photos"
            onUploaded={(url) => onChange({ photos: [...w.photos, url] })}
          />
        ) : (
          <p className="text-xs text-gray-500">Up to {MAX_WEDDING_PHOTOS} photos per wedding.</p>
        )}
      </div>

      <div>
        <label className="label">Video links</label>
        {w.videos.length > 0 && (
          <ul className="mb-2 divide-y divide-gray-200 rounded-sm border border-gray-200">
            {w.videos.map((v, j) => (
              <li key={`${v}-${j}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{v}</span>
                <button
                  type="button"
                  className="text-critical-fg"
                  onClick={() => onChange({ videos: w.videos.filter((_, k) => k !== j) })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {w.videos.length < MAX_WEDDING_VIDEOS && (
          <div className="flex flex-wrap gap-2">
            <input
              className="input flex-1"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoDraft}
              onChange={(e) => setVideoDraft(e.target.value)}
            />
            <button
              type="button"
              className="btn-outline"
              disabled={!videoOk}
              onClick={() => {
                onChange({ videos: [...w.videos, videoDraft.trim()] });
                setVideoDraft('');
              }}
            >
              Add video
            </button>
          </div>
        )}
        {videoDraft.trim() && !videoOk && (
          <p className="mt-1 text-xs text-red-600">A video link must start with https://.</p>
        )}
      </div>

      <div>
        <label className="label">Events</label>
        {w.events.length > 0 && (
          <ul className="mb-2 space-y-2">
            {w.events.map((ev, j) => (
              <li key={j} className="grid gap-2 sm:grid-cols-[1fr_10rem_2fr_auto]">
                <input
                  className="input"
                  placeholder="Haldi"
                  maxLength={80}
                  value={ev.name}
                  onChange={(e) =>
                    onChange({
                      events: w.events.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)),
                    })
                  }
                />
                <input
                  className="input"
                  type="date"
                  value={ev.date}
                  onChange={(e) =>
                    onChange({
                      events: w.events.map((x, k) => (k === j ? { ...x, date: e.target.value } : x)),
                    })
                  }
                />
                <input
                  className="input"
                  placeholder="What happened"
                  maxLength={500}
                  value={ev.description}
                  onChange={(e) =>
                    onChange({
                      events: w.events.map((x, k) =>
                        k === j ? { ...x, description: e.target.value } : x,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="text-sm text-critical-fg"
                  onClick={() => onChange({ events: w.events.filter((_, k) => k !== j) })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="btn-outline"
          disabled={w.events.length >= MAX_WEDDING_EVENTS}
          onClick={() => onChange({ events: [...w.events, { name: '', date: '', description: '' }] })}
        >
          Add an event
        </button>
      </div>
    </div>
  );
}
