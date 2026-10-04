/**
 * Walking a request or response body for the strings in it.
 *
 * Used to find media references wherever a module happens to keep them — a
 * column, a jsonb list, an array of photographs three objects deep — so that
 * storage is handled once, at the edge, instead of in every service that
 * stores a picture.
 */

const MAX_DEPTH = 32;

/** Objects whose insides are not data: dates, buffers, streams, and the like. */
function opaque(value: object): boolean {
  if (value instanceof Date || Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return true;
  if (value instanceof Map || value instanceof Set || value instanceof RegExp) return true;
  // A stream, a StreamableFile, or anything that serialises itself: its JSON
  // is its own business, and rewriting its fields would not change it.
  const candidate = value as { pipe?: unknown; toJSON?: unknown; getStream?: unknown };
  return (
    typeof candidate.pipe === 'function' ||
    typeof candidate.toJSON === 'function' ||
    typeof candidate.getStream === 'function'
  );
}

/** Every string in `value` that `match` accepts. */
export function collectStrings(value: unknown, match: (s: string) => boolean): Set<string> {
  const found = new Set<string>();
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): void => {
    if (typeof v === 'string') {
      if (match(v)) found.add(v);
      return;
    }
    if (v === null || typeof v !== 'object' || depth > MAX_DEPTH || opaque(v) || seen.has(v)) return;
    seen.add(v);
    const children = Array.isArray(v) ? v : Object.values(v);
    for (const child of children) walk(child, depth + 1);
  };
  walk(value, 0);
  return found;
}

/**
 * `value` with every string replaced by `replace(string)`.
 *
 * Copy-on-write: an object none of whose strings change is returned as it is,
 * and nothing passed in is ever mutated. A service may hand back an object it
 * also keeps (a cached list, a constant), and a signed URL written into that
 * would outlive its signature. Entity instances come back as plain objects,
 * which is all JSON would have made of them anyway.
 */
export function mapStrings<T>(value: T, replace: (s: string) => string | null): T {
  // The same object reached twice gets the same answer twice; one still being
  // walked (a cycle) answers as itself.
  const done = new Map<object, unknown>();
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return replace(v);
    if (v === null || typeof v !== 'object' || depth > MAX_DEPTH || opaque(v)) return v;
    if (done.has(v)) return done.get(v);
    done.set(v, v);
    const out = walkObject(v, depth);
    done.set(v, out);
    return out;
  };
  const walkObject = (v: object, depth: number): unknown => {
    if (Array.isArray(v)) {
      let copy: unknown[] | null = null;
      v.forEach((child, i) => {
        const next = walk(child, depth + 1);
        if (next !== child) {
          copy ??= v.slice();
          copy[i] = next;
        }
      });
      return copy ?? v;
    }

    let copy: Record<string, unknown> | null = null;
    for (const [k, child] of Object.entries(v)) {
      const next = walk(child, depth + 1);
      if (next !== child) {
        copy ??= { ...(v as Record<string, unknown>) };
        copy[k] = next;
      }
    }
    return copy ?? v;
  };
  return walk(value, 0) as T;
}
