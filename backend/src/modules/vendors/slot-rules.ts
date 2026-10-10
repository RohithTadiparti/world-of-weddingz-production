/**
 * How many bookings one published window may take.
 *
 * Pure, so the rule is stated once: the DTO validators, the service and the web
 * and mobile forms (frontend/src/lib/catalog-rules.ts) all read these numbers.
 * Twenty is the product ceiling for a single window; a vendor who can genuinely
 * take more publishes a second window rather than one enormous one.
 */
export const MIN_SLOT_CAPACITY = 1;
export const MAX_SLOT_CAPACITY = 20;

export const SLOT_CAPACITY_MAX_MESSAGE = `A window can take at most ${MAX_SLOT_CAPACITY} bookings`;
export const SLOT_CAPACITY_MIN_MESSAGE = `A window must take at least ${MIN_SLOT_CAPACITY} booking`;

/** Why a capacity cannot be used, or null when it can. */
export function slotCapacityProblem(value: number): string | null {
  if (!Number.isInteger(value)) return 'Capacity must be a whole number of bookings';
  if (value < MIN_SLOT_CAPACITY) return SLOT_CAPACITY_MIN_MESSAGE;
  if (value > MAX_SLOT_CAPACITY) return SLOT_CAPACITY_MAX_MESSAGE;
  return null;
}

/**
 * The capacity a window gets when the vendor names none: the service's own
 * figure, held inside the allowed range. A service configured for fifty
 * teams before the ceiling existed seeds twenty rather than a refusal the
 * vendor never asked for.
 */
export function defaultSlotCapacity(serviceCapacity: number | null | undefined): number {
  const n = Number.isInteger(serviceCapacity) ? (serviceCapacity as number) : MIN_SLOT_CAPACITY;
  return Math.min(MAX_SLOT_CAPACITY, Math.max(MIN_SLOT_CAPACITY, n));
}
