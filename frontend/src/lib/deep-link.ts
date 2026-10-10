import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The element id a deep-linked item renders with, so the page can scroll to it. */
export function deepLinkId(kind: string, id: string): string {
  return `${kind}-${id}`;
}

/**
 * The item a notification link points at (`?case=` or `?request=`), scrolled
 * into view once it has rendered (row 21b). Returns the id so the page can
 * highlight it. Rendering is retried for a few frames because the list usually
 * arrives after the first paint.
 */
export function useDeepLink(param: string, kind: string, ready: boolean): string | null {
  const [params] = useSearchParams();
  const [target] = useState(() => params.get(param));

  useEffect(() => {
    if (!target || !ready) return undefined;
    let tries = 0;
    let frame = 0;
    const seek = () => {
      const el = document.getElementById(deepLinkId(kind, target));
      if (el) {
        el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (tries++ < 20) frame = window.requestAnimationFrame(seek);
    };
    seek();
    return () => window.cancelAnimationFrame(frame);
  }, [target, ready, kind]);

  return target;
}
