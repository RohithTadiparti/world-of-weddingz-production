/**
 * Whether the day asked for on a request matches the wedding function it is
 * for, and the sentence that says so when it does not.
 *
 * A request tied to the mehendi is for the mehendi's day. A slot or requested
 * date on some other day would hold the vendor for a date nobody is
 * celebrating, so the request is refused rather than quietly carrying both.
 * An event with no date yet, or a request with no date, has nothing to clash.
 */
export function eventDateMismatch(
  event: { name: string; eventDate: string | Date | null },
  requestedDate: string | null | undefined,
): string | null {
  if (!event.eventDate || !requestedDate) return null;
  const eventDay = isoDay(event.eventDate);
  const asked = isoDay(requestedDate);
  if (eventDay === asked) return null;
  return (
    `${event.name || 'The event'} is on ${eventDay}, but the date you chose is ${asked}. ` +
    'Pick a date that matches the event, or choose a different event.'
  );
}

function isoDay(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}
