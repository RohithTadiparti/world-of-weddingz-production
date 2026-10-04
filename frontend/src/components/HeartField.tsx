import { useEffect, useState } from 'react';
import {
  HEARTS,
  HEART_OPACITY,
  HEART_PATH,
  HEART_STOPS,
  HEART_VIEWBOX_H,
  HEART_VIEWBOX_W,
} from '../lib/heart-field';

/** The gold tokens as the page currently resolves them, for the given theme. */
function goldTokens(): Record<'gold' | 'gold-lit' | 'gold-deep', string> {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string) => `rgb(${css.getPropertyValue(`--${name}`).trim().split(/\s+/).join(',')})`;
  return { gold: read('gold'), 'gold-lit': read('gold-lit'), 'gold-deep': read('gold-deep') };
}

/** The template's heart board — its exact placements, gradient and stroke — as one tile. */
function tile(colours: ReturnType<typeof goldTokens>): string {
  const stops = HEART_STOPS.map(([offset, token]) => `<stop offset="${offset}" stop-color="${colours[token]}"/>`).join('');
  const hearts = HEARTS.map((h) => `<use href="#hs" transform="${h.transform}"/>`).join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${HEART_VIEWBOX_W}" height="${HEART_VIEWBOX_H}" viewBox="0 0 ${HEART_VIEWBOX_W} ${HEART_VIEWBOX_H}">` +
    `<defs><linearGradient id="leaf" x1="0%" y1="0%" x2="72%" y2="100%">${stops}</linearGradient>` +
    `<g id="hs" fill="none" stroke="url(#leaf)" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><path d="${HEART_PATH}"/></g></defs>` +
    `${hearts}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * The matrimony home template's field of struck-gold heart outlines.
 *
 * Drawn exactly as the template draws it: its own 1440 × 2400 board at its
 * own size, centred on the page the way the template centres its content
 * column, repeating down pages longer than one board, and scrolling with the
 * content rather than pinned to the window. Panels and cards cover it with
 * their own white. It takes no pointer events.
 *
 * The tile is rebuilt when the theme changes, because a data URL cannot read
 * the page's CSS variables.
 */
export default function HeartField() {
  const [image, setImage] = useState(() => tile(goldTokens()));

  useEffect(() => {
    const root = document.documentElement;
    const watch = new MutationObserver(() => setImage(tile(goldTokens())));
    watch.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => watch.disconnect();
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10"
      style={{
        backgroundImage: image,
        backgroundSize: `${HEART_VIEWBOX_W}px ${HEART_VIEWBOX_H}px`,
        backgroundPosition: 'top center',
        backgroundRepeat: 'repeat',
        opacity: HEART_OPACITY,
      }}
    />
  );
}
