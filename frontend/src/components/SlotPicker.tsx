import type { ReactNode } from 'react';

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
 * "Pick a date and time": the vendor's free windows by day, or a date asked
 * for when none suits. The one date on the request — the form's own "Date of
 * the function" is answered from this pick rather than asked again.
 */
export default function SlotPicker({
  slots,
  isLoading,
  slotId,
  eventDate,
  onSlot,
  onDate,
  summary,
}: {
  slots: Slot[];
  isLoading: boolean;
  slotId: string;
  eventDate: string;
  /** Choosing a window clears any date typed below, and vice versa. */
  onSlot: (id: string) => void;
  onDate: (date: string) => void;
  /** The service and price being booked, restated above the calendar. */
  summary?: ReactNode;
}) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const byDate = new Map<string, Slot[]>();
  for (const slot of slots) {
    byDate.set(slot.date, [...(byDate.get(slot.date) ?? []), slot]);
  }

  return (
    <div>
      {summary}
      <p className="label">Pick a date and time</p>
      {isLoading && <p className="text-sm text-gray-400">Checking their calendar…</p>}
      {!isLoading && slots.length > 0 && (
        <div className="max-h-56 space-y-3 overflow-y-auto rounded-sm border border-gray-200 p-3">
          {[...byDate.entries()].map(([date, daySlots]) => (
            <div key={date}>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {daySlots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => onSlot(slot.id)}
                    className={`rounded-sm border px-3 py-1.5 text-sm ${
                      slotId === slot.id
                        ? 'border-brand bg-brand-light text-brand-dark'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}
                    {slot.note ? ` · ${slot.note}` : ''}
                    {/*
                      A window a caterer can still take four bookings in
                      reads very differently from one with a single place
                      left, so the buyer sees the count rather than a bare
                      time.
                    */}
                    {slot.capacity > 1 && (
                      <span className="ml-1 text-xs text-gray-500">
                        · {slot.remaining} of {slot.capacity} left
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Slotless request (EZ1-I179): when nothing is published, or none
          of the windows suit, the buyer names a date and the vendor
          confirms it. Choosing a slot above clears this and vice versa. */}
      {!isLoading && !slotId && (
        <label className="mt-2 block text-sm">
          <span className="text-gray-700">
            {slots.length > 0 ? 'Or request another date' : 'Which date do you need?'}
          </span>
          <input
            className="input mt-1 max-w-[12rem]"
            type="date"
            min={todayIso}
            value={eventDate}
            onChange={(e) => onDate(e.target.value)}
          />
          <span className="mt-1 block text-xs text-gray-500">
            No published window — the vendor confirms this date before you pay.
          </span>
        </label>
      )}
    </div>
  );
}
