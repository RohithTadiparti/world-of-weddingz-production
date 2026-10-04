import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { api } from '../../lib/api';
import { DAY_STATUS_LABEL, type PlannerDay, type PlannerDayStatus } from '../../lib/planner-profile';
import { iso, localDate, longDate } from './shared';

/**
 * A month of the planner's calendar, one day at a time.
 *
 * Each published day carries one of four states, drawn as a coloured dot
 * under the date; a day with nothing published is left plain, because the
 * planner may still take it and the couple can ask. Past days cannot be
 * picked. Only the visible month is fetched, so paging forward costs one
 * small request a month.
 */

const DOT: Record<PlannerDayStatus, string> = {
  available: 'bg-positive-fg',
  limited: 'bg-caution-fg',
  booked: 'bg-critical-fg',
  unavailable: 'bg-gray-400',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PlannerCalendar({
  plannerId,
  value,
  onChange,
}: {
  plannerId: string;
  value: string;
  onChange: (date: string) => void;
}) {
  const todayIso = iso(new Date());
  const [month, setMonth] = useState(() => {
    const base = value && value >= todayIso ? localDate(value) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const first = iso(month);
  const last = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const { data: days = [], isLoading, isError } = useQuery({
    queryKey: ['planner-days', plannerId, first, last],
    queryFn: async () =>
      (await api.get(`/wedding-planners/${plannerId}/availability/days`, { params: { from: first, to: last } }))
        .data as PlannerDay[],
    enabled: Boolean(plannerId),
    retry: false,
  });

  const byDate = useMemo(() => new Map(days.map((d) => [d.date.slice(0, 10), d])), [days]);

  // Leading blanks so the first falls under its weekday, then the month.
  const cells = useMemo(() => {
    const lead = month.getDay();
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: count }, (_, i) => iso(new Date(month.getFullYear(), month.getMonth(), i + 1))),
    ];
  }, [month]);

  const isCurrentMonth =
    month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();
  const shift = (by: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1));
  const monthLabel = month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const picked = value ? byDate.get(value) : undefined;
  const pickedInView = value >= first && value <= last;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          disabled={isCurrentMonth}
          className="grid h-10 w-10 place-items-center border border-gray-200 text-gray-700 hover:border-brand hover:text-brand disabled:opacity-35"
          aria-label="Previous month"
        >
          <CaretLeft size={16} aria-hidden />
        </button>
        <p className="font-serif text-lg text-gray-900" aria-live="polite">
          {monthLabel}
        </p>
        <button
          type="button"
          onClick={() => shift(1)}
          className="grid h-10 w-10 place-items-center border border-gray-200 text-gray-700 hover:border-brand hover:text-brand"
          aria-label="Next month"
        >
          <CaretRight size={16} aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-[0.625rem] uppercase tracking-[0.1em] text-gray-500" aria-hidden>
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1">
            {d.slice(0, 2)}
          </span>
        ))}
      </div>
      <div className={`grid grid-cols-7 gap-0.5 ${isLoading ? 'opacity-60' : ''}`}>
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />;
          const past = date < todayIso;
          const day = byDate.get(date);
          const selected = date === value;
          const status = day ? DAY_STATUS_LABEL[day.status] : 'Not published';
          return (
            <button
              key={date}
              type="button"
              disabled={past}
              onClick={() => onChange(date)}
              aria-pressed={selected}
              aria-label={`${longDate(date)}, ${status}`}
              className={`flex aspect-square flex-col items-center justify-center gap-0.5 text-sm tabular-nums transition-colors ${
                selected
                  ? 'bg-brand text-brand-fg'
                  : past
                    ? 'text-gray-300'
                    : 'text-gray-800 hover:bg-brand-soft hover:text-brand'
              } ${date === todayIso && !selected ? 'font-semibold underline underline-offset-2' : ''}`}
            >
              {localDate(date).getDate()}
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  day && !past ? (selected ? 'bg-brand-fg' : DOT[day.status]) : 'bg-transparent'
                }`}
              />
            </button>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-600">
        {(Object.keys(DOT) as PlannerDayStatus[]).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[s]}`} />
            {s === 'limited' ? 'Limited' : DAY_STATUS_LABEL[s]}
          </li>
        ))}
      </ul>

      {isError && (
        <p className="mt-3 text-xs text-gray-500">The calendar could not be loaded. You can still pick a date and ask.</p>
      )}

      <div className="mt-4" aria-live="polite">
        {value ? (
          <DayStatus date={value} day={pickedInView ? picked : undefined} known={pickedInView && !isLoading} />
        ) : (
          <p className="bg-surface-sunken p-3 text-sm text-gray-600">Pick a date to see whether the planner is free.</p>
        )}
      </div>
    </div>
  );
}

/** What the picked day means for the couple, in a sentence. */
function DayStatus({ date, day, known }: { date: string; day?: PlannerDay; known: boolean }) {
  const when = longDate(date);
  if (!day) {
    return (
      <p className="bg-surface-sunken p-3 text-sm text-gray-700">
        <span className="font-medium text-gray-900">{when}</span>
        {known ? ': nothing published yet. You can still ask; the planner confirms.' : ' selected.'}
      </p>
    );
  }
  const tone: Record<PlannerDayStatus, string> = {
    available: 'bg-positive-bg text-positive-fg',
    limited: 'bg-caution-bg text-caution-fg',
    booked: 'bg-critical-bg text-critical-fg',
    unavailable: 'bg-surface-sunken text-gray-700',
  };
  const text: Record<PlannerDayStatus, string> = {
    available: `Available on ${when}`,
    limited: `Limited availability on ${when}`,
    booked: `Booked on ${when}`,
    unavailable: `Not available on ${when}`,
  };
  const note: Record<PlannerDayStatus, string> = {
    available: day.openings > 0 ? `${day.openings} opening${day.openings === 1 ? '' : 's'} left.` : '',
    limited: 'Part of the day is taken. Ask soon.',
    booked: 'Try another date, or ask whether they can make room.',
    unavailable: 'The planner has blocked this day. Try another date.',
  };
  return (
    <p className={`p-3 text-sm ${tone[day.status]}`}>
      <span className="font-medium">{text[day.status]}</span>
      {note[day.status] && <span className="block text-xs opacity-90">{note[day.status]}</span>}
    </p>
  );
}
