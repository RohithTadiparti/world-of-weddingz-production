import type { JSX } from 'react';

type PatternDensity = 'quiet' | 'standard' | 'celebration';

export interface RomanticPatternProps {
  density: PatternDensity;
}

/**
 * A purely decorative, reusable flowering-vine edge treatment.
 *
 * It has no semantic content and deliberately never accepts pointer input, so
 * a page may place it in a clipped ornament layer without affecting controls.
 */
export function RomanticPattern({ density }: RomanticPatternProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={`individual-pattern individual-pattern--${density} pointer-events-none`}
      focusable="false"
      preserveAspectRatio="none"
      viewBox="0 0 1200 240"
    >
      <g className="individual-pattern__foliage" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5">
        <path d="M-40 222C90 220 88 108 220 128s130 86 254 27 168-42 260 14 160 58 238-24 168-93 270-18" />
        <path d="M42 209c8-31 32-51 61-61m-22 39-31-12m49-3 13-30M251 158c-8-32 4-58 31-79m-10 57-30-18m46 11 8-31M480 171c4-28 27-54 54-70m-18 51-26-9m45-7 13-27M772 184c6-28 31-48 59-59m-15 45-27-10m46 4 13-27M1018 147c-3-30 14-56 43-73m-8 55-30-16m45 10 9-30" />
        <path d="M126 185c18-18 34-21 50-18m-7 18c-17 9-32 9-46 4M352 181c18-18 35-22 51-17m-7 18c-17 9-32 9-46 4M650 182c19-18 36-21 52-16m-7 18c-17 8-32 9-46 4M889 159c17-17 34-19 49-14m-8 16c-16 8-30 8-44 3" />
      </g>

      <g className="individual-pattern__roses" fill="currentColor">
        <g transform="translate(146 132)"><circle r="7" /><ellipse cy="-13" rx="8" ry="12" /><ellipse cy="13" rx="8" ry="12" /><ellipse cx="-13" rx="12" ry="8" /><ellipse cx="13" rx="12" ry="8" /><circle r="3" fill="rgb(var(--gold-lit))" /></g>
        <g transform="translate(510 158) scale(.8)"><circle r="7" /><ellipse cy="-13" rx="8" ry="12" /><ellipse cy="13" rx="8" ry="12" /><ellipse cx="-13" rx="12" ry="8" /><ellipse cx="13" rx="12" ry="8" /><circle r="3" fill="rgb(var(--gold-lit))" /></g>
        <g transform="translate(904 116) scale(1.1)"><circle r="7" /><ellipse cy="-13" rx="8" ry="12" /><ellipse cy="13" rx="8" ry="12" /><ellipse cx="-13" rx="12" ry="8" /><ellipse cx="13" rx="12" ry="8" /><circle r="3" fill="rgb(var(--gold-lit))" /></g>
        <g transform="translate(350 170) scale(.55)"><circle r="7" /><ellipse cy="-13" rx="8" ry="12" /><ellipse cy="13" rx="8" ry="12" /><ellipse cx="-13" rx="12" ry="8" /><ellipse cx="13" rx="12" ry="8" /><circle r="3" fill="rgb(var(--gold-lit))" /></g>
        <g transform="translate(760 175) scale(.6)"><circle r="7" /><ellipse cy="-13" rx="8" ry="12" /><ellipse cy="13" rx="8" ry="12" /><ellipse cx="-13" rx="12" ry="8" /><ellipse cx="13" rx="12" ry="8" /><circle r="3" fill="rgb(var(--gold-lit))" /></g>
      </g>

      <g className="individual-pattern__hearts" fill="currentColor">
        <path d="M336 104c-8-12-27-3-18 11l18 19 18-19c9-14-10-23-18-11Z" />
        <path d="M685 86c-7-10-22-3-15 9l15 16 15-16c7-12-8-19-15-9Z" />
        <path d="M1104 139c-8-12-27-3-18 11l18 19 18-19c9-14-10-23-18-11Z" />
      </g>
    </svg>
  );
}
