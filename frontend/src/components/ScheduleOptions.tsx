import type { ReactNode } from 'react';
import { type ScheduleSelection, toggleOption } from '../lib/request-schedule';

/** One published window the vendor can still take. */
export interface Slot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  confirmed: number;
  remaining: number;
  note: string | null;
}

/**
 * The two ways to say when (row 13): "Pick a Date & Time" from the vendor's
 * open slots, and "Request on Date" for a date and time they have not
 * published. Both are always shown, neither starts selected, and each is
 * ticked and unticked on its own -- unticking one never hides the other.
 */
export default function ScheduleOptions({
  value,
  onChange,
  slots,
  isLoading,
  slotsLocked,
  summary,
}: {
  value: ScheduleSelection;
  onChange: (next: ScheduleSelection) => void;
  slots: Slot[];
  isLoading: boolean;
  /** Set when a service must be chosen before its slots can be listed. */
  slotsLocked?: string | null;
  summary?: ReactNode;
}) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const byDate = new Map<string, Slot[]>();
  for (const slot of slots) byDate.set(slot.date, [...(byDate.get(slot.date) ?? []), slot]);

  return (
    <fieldset className="space-y-3">
      <legend className="label">When do you need them?</legend>
      {summary}
      <div className="grid gap-3 lg:grid-cols-2">
        <div
          className={`rounded-sm border p-3 ${value.pickSlot ? 'border-brand bg-brand-light/40' : 'border-gray-200'}`}
        >
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-900">
            <input
              type="checkbox"
              checked={value.pickSlot}
              onChange={() => onChange(toggleOption(value, 'pickSlot'))}
            />
            Pick a Date &amp; Time
          </label>
          <p className="mt-1 text-xs text-gray-500">One of the slots the vendor has published.</p>
          {value.pickSlot && (
            <div className="mt-2">
              {slotsLocked ? (
                <p className="text-sm text-gray-500">{slotsLocked}</p>
              ) : isLoading ? (
                <p className="text-sm text-gray-400">Checking their calendar…</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No open slots are published. Use Request on Date instead.
                </p>
              ) : (
                <div className="max-h-72 space-y-3 overflow-y-auto">
                  {[...byDate.entries()].map(([date, daySlots]) => (
                    <div key={date}>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {daySlots.map((slot) => {
                          const chosen = value.slotId === slot.id;
                          return (
                            <button
                              key={slot.id}
                              type="button"
                              aria-pressed={chosen}
                              onClick={() =>
                                onChange(
                                  chosen
                                    ? { ...value, slotId: '', slotDate: null }
                                    : { ...value, slotId: slot.id, slotDate: slot.date },
                                )
                              }
                              className={`rounded-sm border px-3 py-1.5 text-sm ${
                                chosen
                                  ? 'border-brand bg-brand-light text-brand-dark'
                                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              {slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}
                              {slot.note ? ` · ${slot.note}` : ''}
                              {slot.capacity > 1 && (
                                <span className="ml-1 text-xs text-gray-500">
                                  · {slot.remaining} of {slot.capacity} left
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className={`rounded-sm border p-3 ${value.requestDate ? 'border-brand bg-brand-light/40' : 'border-gray-200'}`}
        >
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-900">
            <input
              type="checkbox"
              checked={value.requestDate}
              onChange={() => onChange(toggleOption(value, 'requestDate'))}
            />
            Request on Date
          </label>
          <p className="mt-1 text-xs text-gray-500">
            A date and time they have not published. The vendor confirms it before you pay.
          </p>
          {value.requestDate && (
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="text-sm">
                <span className="text-gray-700">Date</span>
                <input
                  className="input mt-1"
                  type="date"
                  min={todayIso}
                  value={value.date}
                  onChange={(e) => onChange({ ...value, date: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="text-gray-700">Time</span>
                <input
                  className="input mt-1"
                  type="time"
                  value={value.time}
                  onChange={(e) => onChange({ ...value, time: e.target.value })}
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </fieldset>
  );
}
