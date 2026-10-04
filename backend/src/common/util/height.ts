/**
 * The heights the platform accepts, in whole centimetres: 3 ft 0 in to 8 ft 0 in.
 *
 * One range for the biodata, the partner preferences and the match filters, so
 * a value one of them accepts is never refused by another.
 */
export const MIN_HEIGHT_CM = 91;
export const MAX_HEIGHT_CM = 244;

export function parseHeightCmQuery(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}
