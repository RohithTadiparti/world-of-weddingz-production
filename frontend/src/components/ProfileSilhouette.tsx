import { useState } from 'react';
import {
  SILHOUETTES,
  SILHOUETTE_TONES,
  SILHOUETTE_VIEWBOX,
  silhouetteFor,
  type SilhouetteTone,
} from '../lib/profile-silhouette';

// Mixed into the sunken ground in CSS, so the art follows the theme switch
// without a re-render.
function toneColour(tone: SilhouetteTone): string {
  const { token, amount } = SILHOUETTE_TONES[tone];
  return `color-mix(in srgb, rgb(var(--${token})) ${amount * 100}%, rgb(var(--surface-sunken)))`;
}

/**
 * The gendered stand-in for a person with no photograph: a groom, a bride, or
 * a neutral figure when gender is not recorded. Fills whatever box
 * `className` sizes and rounds — square, 3:2 cover or a small round avatar —
 * with the figure standing on the bottom edge. Decorative only.
 */
export function ProfileSilhouette({
  gender,
  className = '',
}: {
  gender?: string | null;
  className?: string;
}) {
  const shapes = SILHOUETTES[silhouetteFor(gender)];
  return (
    <span aria-hidden className={`block overflow-hidden bg-surface-sunken ${className}`}>
      <svg
        viewBox={SILHOUETTE_VIEWBOX}
        preserveAspectRatio="xMidYMax meet"
        className="h-full w-full"
        focusable="false"
      >
        {shapes.map((s, i) =>
          s.stroke ? (
            <path
              key={i}
              d={s.d}
              fill="none"
              strokeWidth={s.stroke}
              strokeLinecap="round"
              style={{ stroke: toneColour(s.tone) }}
            />
          ) : (
            <path key={i} d={s.d} style={{ fill: toneColour(s.tone) }} />
          ),
        )}
      </svg>
    </span>
  );
}

/**
 * A person's photo, or their silhouette when there is none — or when the one
 * there fails to load, so the browser's broken-image icon never shows
 * (EZ1-I190). Sizing and rounding come from `className`, for both.
 */
export function PersonPhoto({
  url,
  gender,
  className = '',
  onClick,
}: {
  url?: string | null;
  gender?: string | null;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <span onClick={onClick} className="contents">
        <ProfileSilhouette gender={gender} className={className} />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onClick={onClick}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
